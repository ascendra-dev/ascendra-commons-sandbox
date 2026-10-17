import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresAuditEventReader } from './postgres-audit-event-reader';
import type { SqlExecutor } from '../persistence/sql-executor';

const dialect = new PgDialect();

function fakeDb(rows: Array<Record<string, unknown>> = []) {
  return { execute: vi.fn().mockResolvedValue({ rows }) } satisfies SqlExecutor as SqlExecutor & {
    execute: ReturnType<typeof vi.fn>;
  };
}

function rendered(db: ReturnType<typeof fakeDb>, call = 0) {
  return dialect.sqlToQuery(db.execute.mock.calls[call][0] as SQL);
}

let seq = 0;
function row(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  seq += 1;
  return {
    id: `id-${seq}`,
    entity_type: 'invoice',
    entity_id: 'inv-1',
    tenant_id: 'tenant-1',
    actor: 'user-1',
    action: 'status_changed',
    before: { status: 'sent' },
    after: { status: 'paid' },
    correlation_id: 'trace-1',
    reason: null,
    occurred_at: new Date('2026-06-01T10:00:00Z'),
    application: 'ascendra-pay',
    ...over,
  };
}

function reader(db: SqlExecutor) {
  return new PostgresAuditEventReader(db, 'ascendra-pay');
}

describe('PostgresAuditEventReader.find', () => {
  it('always scopes to the application and maps rows to AuditEvent', async () => {
    const db = fakeDb([row({ entity_id: 'a' }), row({ entity_id: 'b', tenant_id: null, before: null })]);
    const result = await reader(db).find({});

    expect(rendered(db).params).toContain('ascendra-pay');
    expect(result.records[0]).toMatchObject({
      entityId: 'a',
      entityType: 'invoice',
      tenantId: 'tenant-1',
      before: { status: 'sent' },
      correlationId: 'trace-1',
      application: 'ascendra-pay',
    });
    expect(result.records[1]).toMatchObject({ tenantId: null, before: null });
    expect(result.nextCursor).toBeUndefined();
  });

  it('ANDs the optional filters as bound params', async () => {
    const db = fakeDb([]);
    await reader(db).find({
      entityType: 'invoice',
      entityId: 'inv-9',
      actor: 'user-7',
      action: 'deleted',
      correlationId: 'trace-xyz',
      occurredAfter: new Date('2026-01-01T00:00:00Z'),
      occurredBefore: new Date('2026-07-01T00:00:00Z'),
    });

    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/entity_type =/i);
    expect(text).toMatch(/entity_id =/i);
    expect(text).toMatch(/actor =/i);
    expect(text).toMatch(/action =/i);
    expect(text).toMatch(/correlation_id =/i);
    expect(text).toMatch(/occurred_at >=/i);
    expect(text).toMatch(/occurred_at </i);
    expect(params).toEqual(expect.arrayContaining(['invoice', 'inv-9', 'user-7', 'deleted', 'trace-xyz']));
  });

  it('distinguishes an absent tenantId (no filter) from an explicit null (IS NULL)', async () => {
    const none = fakeDb([]);
    await reader(none).find({});
    expect(rendered(none).sql).not.toMatch(/tenant_id (=|is null)/i); // no tenant filter in WHERE (column still in SELECT list)

    const platform = fakeDb([]);
    await reader(platform).find({ tenantId: null });
    expect(rendered(platform).sql).toMatch(/tenant_id is null/i);

    const one = fakeDb([]);
    await reader(one).find({ tenantId: 't-3' });
    expect(rendered(one).sql).toMatch(/tenant_id =/i);
    expect(rendered(one).params).toContain('t-3');
  });

  it('returns a nextCursor when more rows exist and keys the next page off it', async () => {
    const many = Array.from({ length: 51 }, (_, i) => row({ id: `id-${100 + i}` }));
    const db = fakeDb(many);
    const page = await reader(db).find({ limit: 50 });

    expect(page.records).toHaveLength(50);
    expect(page.nextCursor).toBeTruthy();

    const db2 = fakeDb([]);
    await reader(db2).find({ cursor: page.nextCursor, limit: 50 });
    expect(rendered(db2).sql).toMatch(/occurred_at < .* or .*occurred_at = .* and id </is);
  });

  it('caps limit at 200 and ignores a malformed cursor', async () => {
    const db = fakeDb([]);
    await reader(db).find({ limit: 100_000 });
    expect(rendered(db).params).toContain(201);

    const db2 = fakeDb([]);
    await expect(reader(db2).find({ cursor: 'garbage' })).resolves.toEqual({ records: [] });
  });
});

describe('PostgresAuditEventReader.countUpTo', () => {
  it('counts over a LIMIT-capped subquery with the same filters as find(), ignoring limit/cursor', async () => {
    const db = fakeDb([{ count: 7 }]);
    const count = await reader(db).countUpTo(
      { entityType: 'invoice', tenantId: null, limit: 5, cursor: 'whatever' },
      100_001,
    );

    expect(count).toBe(7);
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/select count\(\*\)::int as count\s+from \(\s*select 1 from commons_audit_event/i);
    expect(text).toMatch(/entity_type =/i);
    expect(text).toMatch(/tenant_id is null/i);
    expect(text).not.toMatch(/id </i);
    expect(params).toEqual(['ascendra-pay', 'invoice', 100_001]);
  });
});

describe('PostgresAuditEventReader.findOne', () => {
  it('scopes to id + application and maps the row', async () => {
    const db = fakeDb([row({ id: 'ae-1' })]);
    const result = await reader(db).findOne('ae-1');

    expect(result).toMatchObject({ id: 'ae-1', entityType: 'invoice' });
    const { sql: text, params } = rendered(db);
    expect(text).toMatch(/id =/i);
    expect(text).toMatch(/application =/i);
    expect(text).not.toMatch(/tenant_id (=|is null)/i); // no tenant filter in WHERE (column still in SELECT list)
    expect(params).toEqual(expect.arrayContaining(['ae-1', 'ascendra-pay']));
  });

  it('returns null when nothing matches (including a cross-tenant id)', async () => {
    const db = fakeDb([]);
    await expect(reader(db).findOne('missing')).resolves.toBeNull();
  });

  it('filters by tenantId when supplied, and by IS NULL for an explicit null', async () => {
    const scoped = fakeDb([]);
    await reader(scoped).findOne('ae-1', 't-3');
    expect(rendered(scoped).sql).toMatch(/tenant_id =/i);
    expect(rendered(scoped).params).toContain('t-3');

    const platformOnly = fakeDb([]);
    await reader(platformOnly).findOne('ae-1', null);
    expect(rendered(platformOnly).sql).toMatch(/tenant_id is null/i);
  });
});

describe('PostgresAuditEventReader.summarizeActor', () => {
  it('aggregates first/last seen, tenants touched, and per-action counts', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({
        rows: [
          {
            first_seen: new Date('2026-06-14T00:00:00Z'),
            last_seen: new Date('2026-09-06T18:03:20Z'),
            total: 30,
            tenants: ['t-kairos', null],
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { action: 'role.assigned', count: 21, last_occurred_at: new Date('2026-09-06T18:03:20Z') },
          { action: 'role.revoked', count: 9, last_occurred_at: new Date('2026-09-04T10:11:00Z') },
        ],
      });

    const summary = await reader(db).summarizeActor('u_1c07', {});

    expect(summary).toEqual({
      actor: 'u_1c07',
      firstSeen: new Date('2026-06-14T00:00:00Z'),
      lastSeen: new Date('2026-09-06T18:03:20Z'),
      totalRecords: 30,
      tenantsTouched: ['t-kairos', null],
      byAction: [
        { action: 'role.assigned', count: 21, lastOccurredAt: new Date('2026-09-06T18:03:20Z') },
        { action: 'role.revoked', count: 9, lastOccurredAt: new Date('2026-09-04T10:11:00Z') },
      ],
    });
    expect(rendered(db, 0).params).toContain('u_1c07');
  });

  it('returns nulls/empties for an actor with no records', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [{ first_seen: null, last_seen: null, total: 0, tenants: null }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(reader(db).summarizeActor('nobody', {})).resolves.toEqual({
      actor: 'nobody',
      firstSeen: null,
      lastSeen: null,
      totalRecords: 0,
      tenantsTouched: [],
      byAction: [],
    });
  });

  it('scopes by tenantId and occurred window when supplied', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [{ first_seen: null, last_seen: null, total: 0, tenants: null }] })
      .mockResolvedValueOnce({ rows: [] });

    await reader(db).summarizeActor('u1', {
      tenantId: 't1',
      occurredAfter: new Date('2026-08-01T00:00:00Z'),
      occurredBefore: new Date('2026-09-01T00:00:00Z'),
    });

    const { sql: text, params } = rendered(db, 0);
    expect(text).toMatch(/tenant_id =/i);
    expect(text).toMatch(/occurred_at >=/i);
    expect(text).toMatch(/occurred_at </i);
    expect(params).toEqual(expect.arrayContaining(['t1']));
  });
});

describe('PostgresAuditEventReader.stats', () => {
  it('shapes perDay/topActions/topActors/perTenant from four grouped queries', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [{ day: '2026-09-07', count: 312 }] })
      .mockResolvedValueOnce({ rows: [{ action: 'invoice.status_changed', count: 612 }] })
      .mockResolvedValueOnce({ rows: [{ actor: 'svc_reconciler', count: 488 }] })
      .mockResolvedValueOnce({ rows: [{ tenant_id: 't_kairos', count: 900 }] });

    const stats = await reader(db).stats('30d');

    expect(stats).toEqual({
      window: '30d',
      perDay: [{ day: '2026-09-07', count: 312 }],
      topActions: [{ action: 'invoice.status_changed', count: 612 }],
      topActors: [{ actor: 'svc_reconciler', count: 488 }],
      perTenant: [{ tenantId: 't_kairos', count: 900 }],
    });
  });

  it('scopes every query to tenantId when supplied', async () => {
    const db = fakeDb([]);
    await reader(db).stats('7d', 't9');
    for (let i = 0; i < 4; i += 1) {
      const { sql: text, params } = rendered(db, i);
      expect(text).toMatch(/tenant_id =/i);
      expect(params).toEqual(expect.arrayContaining(['t9']));
    }
  });

  it('defaults to a 30-day window for an unparseable window string', async () => {
    const db = fakeDb([]);
    await reader(db).stats('not-a-window');
    expect(rendered(db, 0).sql).toMatch(/occurred_at >=/i);
  });
});

describe('PostgresAuditEventReader.countByDeclared', () => {
  it('counts each declared entity type and action, defaulting to 0 when never audited', async () => {
    const db = fakeDb();
    db.execute
      .mockResolvedValueOnce({ rows: [{ entity_type: 'invoice', count: 18402 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await reader(db).countByDeclared({ entityTypes: ['invoice', 'dispute'], actions: ['payout.reversed'] });

    expect(result).toEqual([
      { kind: 'entityType', value: 'invoice', count: 18402, assessment: 'healthy' },
      { kind: 'entityType', value: 'dispute', count: 0, assessment: 'never_audited' },
      { kind: 'action', value: 'payout.reversed', count: 0, assessment: 'never_audited' },
    ]);
  });

  it('dedupes repeated declared entries', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [{ entity_type: 'invoice', count: 5 }] });

    const result = await reader(db).countByDeclared({ entityTypes: ['invoice', 'invoice'], actions: [] });
    expect(result).toEqual([{ kind: 'entityType', value: 'invoice', count: 5, assessment: 'healthy' }]);
  });

  it('skips a query entirely when a declared list is empty', async () => {
    const db = fakeDb([]);
    await reader(db).countByDeclared({ entityTypes: [], actions: [] });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('scopes counts by tenantId when supplied', async () => {
    const db = fakeDb();
    db.execute.mockResolvedValueOnce({ rows: [] });
    await reader(db).countByDeclared({ entityTypes: ['invoice'], actions: [], tenantId: 't1' });
    const { sql: text, params } = rendered(db, 0);
    expect(text).toMatch(/tenant_id =/i);
    expect(params).toEqual(expect.arrayContaining(['t1']));
  });
});
