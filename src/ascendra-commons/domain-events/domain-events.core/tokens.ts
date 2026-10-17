/**
 * Injection token. A Symbol, not a string literal — same reasoning as every
 * other module in this library: a typo in a binding becomes a compile error,
 * not a silently unbound provider.
 *
 * `DomainEventEmitter` is a TypeScript interface (no runtime representation),
 * with the transport implementation chosen by which module the consumer wires
 * to `DomainEventsModule.forRoot({ emitterToken })` —
 * `IN_PROCESS_DOMAIN_EVENT_EMITTER` (Model 1) or `BROKER_DOMAIN_EVENT_EMITTER`
 * (Model 2). Call sites depend on this token, so switching transports never
 * touches a call site.
 */
export const DOMAIN_EVENT_EMITTER = Symbol('DOMAIN_EVENT_EMITTER');

/**
 * What a transport (currently only `InProcessDomainEventEmitter`) injects to
 * log delivery attempts. Optional — a transport falls back to
 * `NoopEventDeliveryRecorder` when nothing is bound. A stack adapter's
 * recorder module binds this (`domain-events.core.postgres-drizzle`'s
 * `PostgresEventDeliveryRecorderModule` does).
 */
export const EVENT_DELIVERY_RECORDER = Symbol('EVENT_DELIVERY_RECORDER');

/**
 * What an admin/observability caller injects — bound to an
 * `EventDeliveryObservabilityPort` implementation. A stack adapter's
 * observability module binds it; `domain-events.api` consumes it. Never
 * touched by feature code.
 */
export const EVENT_DELIVERY_OBSERVABILITY_PORT = Symbol('EVENT_DELIVERY_OBSERVABILITY_PORT');

/**
 * What an admin/observability caller injects — bound to an
 * `EventListenerCatalogPort` implementation. Only
 * `domain-events.core.in-process` provides one (see that port's own doc
 * comment for why); `domain-events.api` consumes it.
 */
export const EVENT_LISTENER_CATALOG_PORT = Symbol('EVENT_LISTENER_CATALOG_PORT');
