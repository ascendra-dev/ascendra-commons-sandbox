import { describe, expect, it, vi } from 'vitest';
import { getTableColumns, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuditEventInput } from '../../audit-logging.core';
import { auditEventTable } from './audit-event.schema';
import { PostgresAuditEventRepository } from './postgres-audit-event.repository';
import type { SqlExecutor } from './sql-executor';

const dialect = new PgDialect();

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rows: [] }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

/** Render the single statement this repo issued to `{ sql, params }`, the way the pg driver would. */
function rendered(db: ReturnType<typeof fakeDb>) {
  return dialect.sqlToQuery(db.execute.mock.calls[0][0] as SQL);
}

function input(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    entityType: 'invoice',
    entityId: 'inv-1',
    tenantId: 'tenant-1',
    actor: 'user-1',
    action: 'status_changed',
    before: { status: 'sent' },
    after: { status: 'paid' },
    correlationId: 'trace-1',
    reason: null,
    occurredAt: new Date('2026-01-03T10:00:00Z'),
    ...overrides,
  };
}

describe('PostgresAuditEventRepository', () => {
  it('issues exactly one insert statement', async () => {
    const db = fakeDb();
    await new PostgresAuditEventRepository(db, 'ascendra-pay').insert(input());

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(rendered(db).sql).toMatch(/insert into commons_audit_event/i);
  });

  it('stamps the injected application, not anything off the record', async () => {
    const db = fakeDb();
    await new PostgresAuditEventRepository(db, 'ascendra-erp').insert(input());

    expect(rendered(db).params).toContain('ascendra-erp');
  });

  it('binds the event fields as parameters — nothing string-interpolated into the SQL text', async () => {
    const db = fakeDb();
    const actor = "Robert'); DROP TABLE commons_audit_event;--";
    await new PostgresAuditEventRepository(db, 'ascendra-pay').insert(input({ actor }));

    const { sql: text, params } = rendered(db);
    expect(text).not.toContain('DROP TABLE');
    expect(params).toContain(actor);
  });

  it('serialises before/after as jsonb parameters', async () => {
    const db = fakeDb();
    await new PostgresAuditEventRepository(db, 'ascendra-pay').insert(
      input({ before: { status: 'sent' }, after: { status: 'paid', paidBy: 'user-1' } }),
    );

    const { sql: text, params } = rendered(db);
    expect(text).toContain('::jsonb');
    expect(params).toContain(JSON.stringify({ status: 'sent' }));
    expect(params).toContain(JSON.stringify({ status: 'paid', paidBy: 'user-1' }));
  });

  it('keeps a null before/after as a real SQL NULL, not the string "null"', async () => {
    const db = fakeDb();
    await new PostgresAuditEventRepository(db, 'ascendra-pay').insert(input({ before: null, after: null }));

    expect(rendered(db).params).not.toContain('null');
  });

  it('passes a null tenantId through — a platform-level event with no single tenant', async () => {
    const db = fakeDb();
    await new PostgresAuditEventRepository(db, 'ascendra-pay').insert(input({ tenantId: null }));

    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("writes the event's own occurredAt, never Date.now()", async () => {
    const db = fakeDb();
    const occurredAt = new Date('2025-11-20T08:30:00Z');
    await new PostgresAuditEventRepository(db, 'ascendra-pay').insert(input({ occurredAt }));

    expect(rendered(db).params).toContain(occurredAt);
  });

  it('writes every column the schema defines except the db-assigned id — guards against schema/INSERT drift', async () => {
    const db = fakeDb();
    await new PostgresAuditEventRepository(db, 'ascendra-pay').insert(input());

    const { sql: text } = rendered(db);
    const expected = Object.values(getTableColumns(auditEventTable))
      .map((c) => (c as { name: string }).name)
      .filter((name) => name !== 'id');
    for (const column of expected) {
      expect(text).toContain(column);
    }
  });

  it('propagates a database failure — never swallows it', async () => {
    const db = fakeDb();
    db.execute.mockRejectedValueOnce(new Error('unique_violation'));

    await expect(new PostgresAuditEventRepository(db, 'ascendra-pay').insert(input())).rejects.toThrow('unique_violation');
  });
});
