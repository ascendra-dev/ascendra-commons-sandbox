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
/**
 * What one audited change carries — named, so no two of its strings can be swapped unnoticed (positional, three
 * strings in a row compiled fine either way round).
 */
export interface AuditRecordFields {
  /** What changed — e.g. `'invoice'`. */
  entityType: string;
  entityId: string;
  /** Whose data it is. Required, even when `null`: a platform-level change (no tenant) is visible only to platform admins, so it's never a default. */
  tenantId: string | null;
  /** Who made the change — e.g. `'admin@acme.test'`, `'system:payment-gateway'`. */
  actor: string;
  /** Verb only — `'status_changed'`; `entityType` carries the resource. */
  action: string;
  /** The state before — omit (or `null`) for a create. */
  before?: Record<string, unknown> | null;
  /** The state after — omit (or `null`) for a delete. */
  after?: Record<string, unknown> | null;
  /** When the business fact happened — not when the record is written. */
  occurredAt: Date;
  /** An optional free-text justification. */
  reason?: string | null;
}

export class AuditRecordRaised implements DomainEvent {
  readonly entityType: string;
  readonly entityId: string;
  readonly tenantId: string | null;
  readonly actor: string;
  readonly action: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly occurredAt: Date;
  readonly reason: string | null;

  constructor(fields: AuditRecordFields) {
    this.entityType = fields.entityType;
    this.entityId = fields.entityId;
    this.tenantId = fields.tenantId;
    this.actor = fields.actor;
    this.action = fields.action;
    this.before = fields.before ?? null;
    this.after = fields.after ?? null;
    this.occurredAt = fields.occurredAt;
    this.reason = fields.reason ?? null;
  }
}
