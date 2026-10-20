import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_audit_event` table — one concrete Postgres/Drizzle shape of
 * the generic `AuditEvent` interface (see `../../audit-event.interface.ts`).
 *
 * Every column maps 1:1 to an `AuditEvent` field, plus `application` (see its
 * own note below). This is the single source of truth for the reference
 * schema: `PostgresAuditEventRepository` writes exactly these columns — change
 * the two together, and ship the change as the next numbered file in
 * `../migrations/` (never an edit to a released one).
 *
 * A consuming project never re-exports this table into the schema files
 * `drizzle-kit` reads — the DDL comes from `../migrations/`. A project on a
 * different stack ignores this file entirely and
 * provides its own `AuditEventRepository` (see the adapter README).
 */
export const auditEventTable = pgTable(
  'commons_audit_event',
  {
    /** Assigned by Postgres on insert — never supplied by the caller, so it is not part of `AuditEventInput`. */
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** Nullable — a platform-level change (e.g. editing a platform-owned role catalog) has no single tenant. */
    tenantId: text('tenant_id'),
    actor: text('actor').notNull(),
    /** Verb only (`'status_changed'`), never `resource.verb` — `entity_type` already carries the resource. See the module README. */
    action: text('action').notNull(),
    /** Nullable — a "create" has no before-state. */
    before: jsonb('before').$type<Record<string, unknown>>(),
    /** Nullable — a "delete" has no after-state. */
    after: jsonb('after').$type<Record<string, unknown>>(),
    /** Always present — `getCurrentCorrelationId()` mints one if no context was established. */
    correlationId: text('correlation_id').notNull(),
    /** Nullable — an optional free-text justification for the change. */
    reason: text('reason'),
    /** The business fact's own time, not the moment the audit row was written. */
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    /**
     * Which Ascendra application wrote this row (e.g. `'ascendra-pay'`) —
     * stamped on insert from `PostgresAuditPersistenceModule.forRoot({ application })`
     * and filtered on (`application = $1`) by `PostgresAuditEventReader`, so an
     * app's own admin screen sees only its own rows. Constant within one app's
     * database; the column keeps this table correct if audit history is ever
     * consolidated for cross-product compliance reporting (see `MODULE-STANDARD.md`
     * dimension 4, and this module's README "the one to watch" note).
     */
    application: text('application').notNull(),
  },
  (table) => [
    /** "this record's full history" — `AuditQuery` by `entityType`+`entityId` (`GET /audit/entities/:type/:id/history`). */
    index('commons_audit_event_entity_idx').on(table.entityType, table.entityId),
    /** "this tenant's activity feed, recent first" — `AuditQuery` by `tenantId`+`occurredAfter`/`occurredBefore`. */
    index('commons_audit_event_tenant_time_idx').on(table.tenantId, table.occurredAt),
    /** The list newest-first (keyset on `occurred_at`, `id`) and the platform-wide stats — every read is `application`-scoped. (0002) */
    index('commons_audit_event_app_time_idx').on(table.application, table.occurredAt.desc(), table.id.desc()),
    /** A request / job trace, and the list's correlation-id filter. (0002) */
    index('commons_audit_event_correlation_idx').on(table.correlationId),
    /** One actor's activity, and the list's actor filter. (0002) */
    index('commons_audit_event_actor_idx').on(table.application, table.actor, table.occurredAt.desc()),
  ],
);
