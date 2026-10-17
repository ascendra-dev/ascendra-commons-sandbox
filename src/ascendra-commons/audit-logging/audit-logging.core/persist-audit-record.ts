import type { AuditEventRepository } from './audit-event-repository.port';
import type { AuditRecordRaised } from './audit-record-raised';
import { getCurrentCorrelationId } from './correlation-context';

/**
 * The one piece of real logic this pattern ships. AuditEventInput is defined
 * as a Pick<> of AuditRecordRaised (see audit-event.interface.ts), so every
 * field it needs is already on the event except correlationId — added here
 * from ambient context (see correlation-context.ts). No mapping step, unlike
 * the older AuditableDomainEvent design this replaced.
 */
export async function persistAuditRecord(
  auditRepo: AuditEventRepository,
  event: AuditRecordRaised,
): Promise<void> {
  await auditRepo.insert({
    entityType: event.entityType,
    entityId: event.entityId,
    tenantId: event.tenantId,
    actor: event.actor,
    action: event.action,
    before: event.before,
    after: event.after,
    reason: event.reason,
    correlationId: getCurrentCorrelationId(),
    occurredAt: event.occurredAt, // the business fact's own time, not "now" — see AuditRecordRaised's doc comment
  });
}
