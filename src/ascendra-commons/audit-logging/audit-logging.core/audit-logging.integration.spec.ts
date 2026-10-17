import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainEventsModule, DOMAIN_EVENT_EMITTER } from '../../domain-events/domain-events.core';
import type { DomainEventEmitter } from '../../domain-events/domain-events.core';
import {
  InProcessDomainEventEmitterModule,
  IN_PROCESS_DOMAIN_EVENT_EMITTER,
} from '../../domain-events/domain-events.core.in-process';
import { AuditLoggingModule } from './audit-logging.module';
import { AUDIT_EVENT_NAME, AUDIT_EVENT_REPOSITORY } from './tokens';
import { AuditEventRepository } from './audit-event-repository.port';
import { AuditRecordRaised } from './audit-record-raised';
import { runWithCorrelationId } from './correlation-context';

const AUDIT_REPO_IMPL = Symbol('AUDIT_REPO_IMPL');

/**
 * Feature code writes no listener at all — AuditListener is shipped by
 * AuditLoggingModule.forRoot() itself (see audit-logging.module.ts). What
 * these tests actually prove, real DI included, not reasoned through: a
 * provider declared *inside* a dynamic module's own `providers` array is
 * still discovered by NestJS's @OnCriticalEvent() EventSubscribersLoader,
 * which scans the whole module graph, not just the root testing module — the
 * exact claim this redesign depends on, verified here rather than assumed.
 */
async function buildTestModule(insert: AuditEventRepository['insert']) {
  @Module({
    providers: [{ provide: AUDIT_REPO_IMPL, useValue: { insert } satisfies AuditEventRepository }],
    exports: [AUDIT_REPO_IMPL],
  })
  class FakeAuditRepoModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [
      DomainEventsModule.forRoot({
        emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
        imports: [InProcessDomainEventEmitterModule.forRoot()],
      }),
      AuditLoggingModule.forRoot({ auditEventRepositoryToken: AUDIT_REPO_IMPL, imports: [FakeAuditRepoModule] }),
    ],
  }).compile();

  await moduleRef.init(); // required for EventSubscribersLoader to discover @OnCriticalEvent()-decorated providers
  return moduleRef;
}

describe('audit-logging + domain-events, real end to end', () => {
  it('emitCritical(AUDIT_EVENT_NAME, ...) reaches the shipped AuditListener, which persists via the real repository', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const moduleRef = await buildTestModule(insert);
    const emitter = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);

    const event = new AuditRecordRaised(
      'test_entity',
      'entity-1',
      'tenant-1',
      'user-1',
      'changed',
      { status: 'old' },
      { status: 'new' },
      new Date('2026-02-01T00:00:00Z'),
    );
    await emitter.emitCritical(AUDIT_EVENT_NAME, event);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'test_entity',
        entityId: 'entity-1',
        occurredAt: event.occurredAt, // the event's own time, not Date.now() at listener execution
        reason: null,
      }),
    );
    await moduleRef.close();
  });

  it('a failed insert propagates out of emitCritical(), proving the audit-write-must-not-be-silently-dropped guarantee is real', async () => {
    const insert = vi.fn(async () => {
      throw new Error('constraint violation');
    });
    const moduleRef = await buildTestModule(insert);
    const emitter = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);

    let caught: unknown;
    try {
      await emitter.emitCritical(
        AUDIT_EVENT_NAME,
        new AuditRecordRaised('test_entity', 'entity-2', null, 'user-1', 'changed', null, null, new Date()),
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('constraint violation');
    await moduleRef.close();
  });

  it('the correlation id established around the emit is the one persisted', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const moduleRef = await buildTestModule(insert);
    const emitter = moduleRef.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER);

    await runWithCorrelationId('trace-abc', async () => {
      await emitter.emitCritical(
        AUDIT_EVENT_NAME,
        new AuditRecordRaised('test_entity', 'entity-3', null, 'user-1', 'changed', null, null, new Date()),
      );
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'trace-abc' }));
    await moduleRef.close();
  });

  it("moduleRef.get(AUDIT_EVENT_REPOSITORY) resolves to the same repository the shipped listener writes through", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const moduleRef = await buildTestModule(insert);
    const repo = moduleRef.get<AuditEventRepository>(AUDIT_EVENT_REPOSITORY);

    await repo.insert({
      entityType: 'invoice',
      entityId: 'inv-1',
      tenantId: null,
      actor: 'user-1',
      action: 'created',
      before: null,
      after: null,
      correlationId: 'c1',
      reason: null,
      occurredAt: new Date(),
    });

    expect(insert).toHaveBeenCalledTimes(1);
    await moduleRef.close();
  });
});
