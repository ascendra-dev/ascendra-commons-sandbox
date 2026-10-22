import { sql } from 'drizzle-orm';
import { bigserial, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_domain_events_delivery` table — one row per
 * `emit()`/`emitCritical()` call, written by `InProcessDomainEventEmitter`
 * through `PostgresEventDeliveryRecorder`. **Delivery only** — whether a
 * listener was subscribed and the hand-off happened — never a listener's own
 * outcome; see `domain-events.core`'s README, "What this does and doesn't
 * observe."
 *
 * Source of truth for the columns — change it together with the INSERT in
 * `postgres-event-delivery-recorder.ts`, and ship the change as the next
 * numbered file in `../migrations/` (never an edit to a released one).
 */
export const domainEventDeliveryTable = pgTable(
  'commons_domain_events_delivery',
  {
    /** Assigned by Postgres on insert — an append-only ordered log, never looked up by id from outside. */
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    application: text('application').notNull(),
    eventName: text('event_name').notNull(),
    /** `'emit' | 'emitCritical'`. */
    method: text('method').notNull(),
    /** `'in-process'` today — free once a broker transport records too. */
    transport: text('transport').notNull(),
    /** The business fact's own time (`event.occurredAt`), not when this row was written — what every read is on. */
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** `EventEmitter2.listenerCount(eventName)`, read before dispatch. */
    listenerCount: integer('listener_count').notNull(),
    /** `'delivered' | 'no_listeners' | 'dispatch_failed'` — see `EventDeliveryAttempt.status`. */
    status: text('status').notNull(),
    /** Nullable — set only for `dispatch_failed`. */
    reason: text('reason'),
    /** Nullable — the caller's correlation id, when threaded through `emit()`/`emitCritical()`, for a cross-module trace. */
    correlationId: text('correlation_id'),
  },
  (t) => [
    /** The log newest-first (keyset on occurred_at, id), the summary / catalog / volume periods, and the pruner. */
    index('commons_domain_events_delivery_list_idx').on(t.application, t.occurredAt.desc(), t.id.desc()),
    /** The log filtered by event name, newest first. */
    index('commons_domain_events_delivery_event_idx').on(t.application, t.eventName, t.occurredAt.desc(), t.id.desc()),
    /** "deliveries that need attention" — the log filtered by status. */
    index('commons_domain_events_delivery_status_occurred_idx').on(t.application, t.status, t.occurredAt.desc(), t.id.desc()),
    /** A request / job trace, and the log's correlation-id filter — partial: not every emit carries one. */
    index('commons_domain_events_delivery_correlation_idx').on(t.correlationId).where(sql`${t.correlationId} is not null`),
  ],
);
