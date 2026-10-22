/**
 * Injection token for Model 1 (in-process transport). Symbol, not a string
 * literal.
 */

/**
 * What `InProcessDomainEventEmitterModule` exports as its `DomainEventEmitter`
 * implementation. Pass it to
 * `DomainEventsModule.forRoot({ emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER })`.
 */
export const IN_PROCESS_DOMAIN_EVENT_EMITTER = Symbol('IN_PROCESS_DOMAIN_EVENT_EMITTER');

/**
 * The app's ambient correlation id, for an `emit()` / `emitCritical()` call made without one — provided by
 * `InProcessDomainEventEmitterModule.forRoot({ correlationIdResolver })`. Unbound by default.
 */
export const DOMAIN_EVENT_CORRELATION_ID_RESOLVER = Symbol('DOMAIN_EVENT_CORRELATION_ID_RESOLVER');

/** Returns the current request's / job's correlation id, or undefined when there's none. */
export type CorrelationIdResolver = () => string | undefined;
