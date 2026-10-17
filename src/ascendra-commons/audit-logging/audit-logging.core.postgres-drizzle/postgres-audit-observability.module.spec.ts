import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { AuditEventReader } from '../audit-logging.core';
import { PostgresAuditObservabilityModule } from './postgres-audit-observability.module';
import { AUDIT_EVENT_READER } from '../audit-logging.core';

const DB = Symbol('DB');
const dialect = new PgDialect();

function dbModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({ providers: [{ provide: DB, useValue: { execute } }], exports: [DB] })
  class DbModule {}
  return { DbModule, execute };
}

describe('PostgresAuditObservabilityModule', () => {
  it('resolves AUDIT_EVENT_READER wired to the db token and application', async () => {
    const { DbModule, execute } = dbModule();

    const moduleRef = await Test.createTestingModule({
      imports: [
        PostgresAuditObservabilityModule.forRoot({
          sqlExecutorToken: DB,
          application: 'ascendra-erp',
          imports: [DbModule],
        }),
      ],
    }).compile();

    const reader = moduleRef.get<AuditEventReader>(AUDIT_EVENT_READER);
    await reader.find({ actor: 'u1' });

    expect(execute).toHaveBeenCalledTimes(1);
    const { sql: text, params } = dialect.sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(text).toMatch(/from commons_audit_event/i);
    expect(params).toEqual(expect.arrayContaining(['ascendra-erp', 'u1']));
  });
});
