import { Inject, Injectable } from '@nestjs/common';
import { OnCriticalEvent } from '../../domain-events/domain-events.core';
import type { AuditEventRepository } from './audit-event-repository.port';
import type { AuditRecordRaised } from './audit-record-raised';
import { persistAuditRecord } from './persist-audit-record';
import { AUDIT_EVENT_NAME, AUDIT_EVENT_REPOSITORY } from './tokens';

/**
 * Shipped by this library, not consumer-authored — possible only because
 * AUDIT_EVENT_NAME is one fixed name, never project-specific (contrast the
 * older AuditableDomainEvent design, where "which events get audited" was a
 * consumer-maintained list of per-event-name @OnCriticalEvent() decorators).
 * AuditLoggingModule.forRoot() registers this as one of its own providers —
 * see that module's own file.
 *
 * A thin dispatcher by construction, not by discipline — handle() cannot grow
 * real logic, because there is only one thing to do with any AuditRecordRaised
 * regardless of what raised it. This is the reference example domain-events'
 * README cites for "keep the decorated method a thin dispatcher."
 */
@Injectable()
export class AuditListener {
  constructor(@Inject(AUDIT_EVENT_REPOSITORY) private readonly auditRepo: AuditEventRepository) {}

  @OnCriticalEvent(AUDIT_EVENT_NAME)
  async handle(event: AuditRecordRaised) {
    await persistAuditRecord(this.auditRepo, event);
  }
}
