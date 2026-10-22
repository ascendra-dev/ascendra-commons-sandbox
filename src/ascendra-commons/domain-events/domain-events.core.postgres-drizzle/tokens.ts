/**
 * Injection tokens for the Postgres/Drizzle delivery-log adapter. Symbols, not
 * string literals. The write port binds under the core `EVENT_DELIVERY_RECORDER`
 * token; the read port binds under the core `EVENT_DELIVERY_OBSERVABILITY_PORT`
 * token (both from `domain-events.core`) — not adapter-specific tokens, so
 * `domain-events.api` (or your own controller) depends on the port, never on
 * Postgres.
 */

/** Bound to the consumer's Drizzle db via `PostgresEventDeliveryRecorderModule.forRoot({ sqlExecutorToken })` / `PostgresEventDeliveryObservabilityModule.forRoot(...)`. */
export const EVENT_DELIVERY_SQL_EXECUTOR = Symbol('EVENT_DELIVERY_SQL_EXECUTOR');

/**
 * Which Ascendra application this process is — stamped on every delivery row
 * on insert, and filtered on by every read. A plain value provided inside
 * this adapter's own module, not `domain-events.core.broker`'s
 * `DOMAIN_EVENTS_APPLICATION_ID` (a different, broker-only concern — topic
 * naming, not row scoping).
 */
export const EVENT_DELIVERY_APPLICATION_ID = Symbol('EVENT_DELIVERY_APPLICATION_ID');

/** What `PostgresEventDeliveryRecorderModule` exports — pass this as `InProcessDomainEventEmitterModule.forRoot({ recorderToken })`. */
export const POSTGRES_EVENT_DELIVERY_RECORDER = Symbol('POSTGRES_EVENT_DELIVERY_RECORDER');

/** `PostgresEventDeliveryRecorderOptions` — the flush interval and buffer size, from `PostgresEventDeliveryRecorderModule.forRoot()`. */
export const EVENT_DELIVERY_RECORDER_OPTIONS = Symbol('EVENT_DELIVERY_RECORDER_OPTIONS');
