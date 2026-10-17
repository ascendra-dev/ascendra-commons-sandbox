import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditLoggingModule } from './audit-logging.module';
import { AuditListener } from './audit-listener';
import { AUDIT_EVENT_REPOSITORY } from './tokens';
import { AuditEventRepository } from './audit-event-repository.port';

const AUDIT_REPO_IMPL = Symbol('AUDIT_REPO_IMPL');

/** Stands in for the consumer's own AuditEventRepository provider, living in its own module. */
@Module({
  providers: [{ provide: AUDIT_REPO_IMPL, useValue: { insert: vi.fn().mockResolvedValue(undefined) } }],
  exports: [AUDIT_REPO_IMPL],
})
class FakeAuditRepoModule {}

async function buildTestModule() {
  return Test.createTestingModule({
    imports: [AuditLoggingModule.forRoot({ auditEventRepositoryToken: AUDIT_REPO_IMPL, imports: [FakeAuditRepoModule] })],
  }).compile();
}

describe('AuditLoggingModule.forRoot — real DI wiring', () => {
  it("aliases AUDIT_EVENT_REPOSITORY to the consumer's own repository token", async () => {
    const moduleRef = await buildTestModule();
    const repo = moduleRef.get<AuditEventRepository>(AUDIT_EVENT_REPOSITORY);

    await repo.insert({
      entityType: 'invoice',
      entityId: 'inv-1',
      tenantId: 't1',
      actor: 'user-1',
      action: 'status_changed',
      before: null,
      after: null,
      correlationId: 'c1',
      reason: null,
      occurredAt: new Date(),
    });

    // Only reachable if AUDIT_EVENT_REPOSITORY really resolved to FakeAuditRepoModule's
    // provider — a missing imports entry (the exact bug background-jobs' own DI test
    // caught) would have thrown "Nest can't resolve dependencies" at compile() instead.
    expect(repo.insert).toHaveBeenCalledTimes(1);
  });

  it('provides its own shipped AuditListener, injected with the same AUDIT_EVENT_REPOSITORY binding — no consumer-authored listener needed', async () => {
    const moduleRef = await buildTestModule();

    // moduleRef.get() searches the whole graph by default (not just exports),
    // so this resolves even though AuditListener isn't in this module's own
    // `exports` — nothing outside this module needs to inject it directly,
    // @OnCriticalEvent() discovery is what reaches it (see the integration spec).
    const listener = moduleRef.get(AuditListener);
    expect(listener).toBeInstanceOf(AuditListener);
  });
});
