import type { DomainEvent } from '../../domain-events/domain-events.core';

/**
 * A domain event dedicated entirely to auditing — raised explicitly by
 * feature code alongside (or instead of) whatever business-named event other
 * listeners care about, always under the one fixed name AUDIT_EVENT_NAME (see
 * tokens.ts). This class is the single source of truth for "what facts does
 * an audited change carry" — AuditEventInput/AuditEvent (audit-event.interface.ts)
 * derive their own shape from it (via Pick<>) rather than re-declaring the
 * same fields, so persist-audit-record.ts needs no mapping step and the two
 * shapes can't drift apart.
 *
 * This replaces the older AuditableDomainEvent design (a business event
 * mapping itself to an audit record via toAuditRecord()). That design coupled
 * "is this event audited" to two separately-maintained facts that had to
 * agree by convention — the event class implementing the interface, and a
 * consumer-authored listener subscribing to that event's own name — with
 * nothing enforcing they stayed in sync. Making the audit event's name fixed
 * and library-defined removes that coupling: whether something is audited is
 * now answered by one fact, visible at the call site — did the producer
 * construct and emit an AuditRecordRaised — and this library can ship the one
 * listener that reacts to it, rather than asking every consumer to hand-write
 * one (see audit-listener.ts).
 */
export class AuditRecordRaised implements DomainEvent {
  constructor(
    public readonly entityType: string,
    public readonly entityId: string,
    public readonly tenantId: string | null,
    public readonly actor: string,
    public readonly action: string,
    public readonly before: Record<string, unknown> | null,
    public readonly after: Record<string, unknown> | null,
    public readonly occurredAt: Date,
    public readonly reason: string | null = null,
  ) {}
}
