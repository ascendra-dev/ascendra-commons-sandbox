import type { AuditRecordRaised } from './audit-record-raised';
import type { FieldDiffEntry } from './field-diff';

/**
 * What a repository's insert() accepts. AuditRecordRaised is the single
 * source of truth for "what facts does an audited change carry" — this picks
 * exactly those fields rather than re-declaring them, so the two shapes can't
 * drift apart. `correlationId` is added on top: persistAuditRecord() supplies
 * it at persist time from ambient context (see correlation-context.ts), not
 * from the event itself — an AuditRecordRaised never carries one.
 */
export type AuditEventInput = Pick<
  AuditRecordRaised,
  'entityType' | 'entityId' | 'tenantId' | 'actor' | 'action' | 'before' | 'after' | 'occurredAt' | 'reason'
> & {
  readonly correlationId: string;
};

/**
 * The persisted, immutable record — AuditEventInput plus what the persistence
 * layer assigned on insert (never supplied by the caller, so neither can be
 * part of AuditEventInput): the id, and the application that wrote it. No UPDATE or DELETE is ever exposed
 * against this shape at the application layer — audit records are
 * write-once. What `AuditEventReader.find()` / `findOne()` read back.
 */
export interface AuditEvent extends AuditEventInput {
  readonly id: string;
  /**
   * Which Ascendra application wrote this record (e.g. `'ascendra-pay'`) — stamped by the
   * persistence adapter from its `forRoot({ application })`. Constant within one app's own
   * database today; it's what distinguishes rows once audit history is consolidated.
   */
  readonly application: string;
}

/**
 * What `GET /audit/events/:id` (Record Detail) returns — the record plus its
 * server-computed field-level diff, so the client never diffs raw `before`/
 * `after` JSON itself. See `diffFields` in `field-diff.ts`.
 */
export interface AuditEventDetail extends AuditEvent {
  diff: FieldDiffEntry[];
}
