import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainEventsModule, DOMAIN_EVENT_EMITTER } from '../../domain-events/domain-events.core';
import type { DomainEventEmitter } from '../../domain-events/domain-events.core';
import {
  InProcessDomainEventEmitterModule,
  IN_PROCESS_DOMAIN_EVENT_EMITTER,
} from '../../domain-events/domain-events.core.in-process';
import {
  AuditLoggingModule,
  AUDIT_EVENT_NAME,
  AUDIT_EVENT_REPOSITORY,
  AuditRecordRaised,
  runWithCorrelationId,
} from '../audit-logging.core';
import type { AuditEventRepository } from '../audit-logging.core';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PostgresAuditPersistenceModule } from './postgres-audit-persistence.module';
import { POSTGRES_AUDIT_EVENT_REPOSITORY } from './tokens';

const DB_CONNECTION = Symbol('DB_CONNECTION');
const dialect = new PgDialect();

/** Stands in for the consuming app's own Drizzle db provider. */
function fakeDatabaseModule() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  @Module({
    providers: [{ provide: DB_CONNECTION, useValue: { execute } }],
    exports: [DB_CONNECTION],
  })
  class FakeDatabaseModule {}
  return { FakeDatabaseModule, execute };
}

async function buildApp(application = 'ascendra-pay') {
  const { FakeDatabaseModule, execute } = fakeDatabaseModule();
  const moduleRef = await Test.createTestingModule({
    imports: [
      DomainEventsModule.forRoot({ emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER, imports: [InProcessDomainEventEmitterModule.forRoot()] }),
      AuditLoggingModule.forRoot({
        auditEventRepositoryToken: POSTGRES_AUDIT_EVENT_REPOSITORY,
        imports: [
          PostgresAuditPersistenceModule.forRoot({
            sqlExecutorToken: DB_CONNECTION,
            application,
            imports: [FakeDatabaseModule],
          }),
        ],
      }),
    ],
  }).compile();
  await moduleRef.init();
  return { moduleRef, execute };
}

function renderedParams(execute: ReturnType<typeof vi.fn>): unknown[] {
  return dialect.sqlToQuery(execute.mock.calls[0][0] as SQL).params;
}

describe('PostgresAuditPersistenceModule wired into AuditLoggingModule', () => {
  it('resolves AUDIT_EVENT_REPOSITORY to the reference PostgresAuditEventRepository, aliased to the consumer db token', async () => {
    const { moduleRef, execute } = await buildApp();
    const repo = moduleRef.get<AuditEventRepository>(AUDIT_EVENT_REPOSITORY);

    await repo.insert({
      entityType: 'invoice',
      entityId: 'inv-1',
      tenantId: 't1',
      actor: 'user-1',
      action: 'created',
      before: null,
      after: null,
      correlationId: 'c1',
      reason: null,
      occurredAt: new Date('2026-02-01T00:00:00Z'),
    });

    // Only reachable if AUDIT_SQL_EXECUTOR really resolved to DB_CONNECTION's fake —
    // a missing imports entry would have thrown "Nest can't resolve dependencies" at compile().
    expect(execute).toHaveBeenCalledTimes(1);
    await moduleRef.close();
  });

  it('an emitCritical(AUDIT_EVENT_NAME) reaches the shipped listener, which writes through this repository with the ambient correlation id and configured application', async () => {
    const { moduleRef, execute } = await buildApp('ascendra-erp');
    const emitter = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);

    await runWithCorrelationId('trace-xyz', async () => {
      await emitter.emitCritical(
        AUDIT_EVENT_NAME,
        new AuditRecordRaised('invoice', 'inv-9', 'tenant-1', 'user-1', 'status_changed', null, null, new Date()),
      );
    });

    const params = renderedParams(execute);
    expect(params).toContain('trace-xyz');
    expect(params).toContain('ascendra-erp');
    await moduleRef.close();
  });

  it('a database failure propagates out of emitCritical() — the audit-write-must-not-be-dropped guarantee holds through the reference adapter', async () => {
    @Module({
      providers: [{ provide: DB_CONNECTION, useValue: { execute: vi.fn().mockRejectedValue(new Error('constraint violation')) } }],
      exports: [DB_CONNECTION],
    })
    class FailingDbModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        DomainEventsModule.forRoot({ emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER, imports: [InProcessDomainEventEmitterModule.forRoot()] }),
        AuditLoggingModule.forRoot({
          auditEventRepositoryToken: POSTGRES_AUDIT_EVENT_REPOSITORY,
          imports: [
            PostgresAuditPersistenceModule.forRoot({
              sqlExecutorToken: DB_CONNECTION,
              application: 'ascendra-pay',
              imports: [FailingDbModule],
            }),
          ],
        }),
      ],
    }).compile();
    await moduleRef.init();
    const emitter = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);

    await expect(
      emitter.emitCritical(
        AUDIT_EVENT_NAME,
        new AuditRecordRaised('invoice', 'inv-2', null, 'user-1', 'deleted', null, null, new Date()),
      ),
    ).rejects.toThrow('constraint violation');
    await moduleRef.close();
  });
});
