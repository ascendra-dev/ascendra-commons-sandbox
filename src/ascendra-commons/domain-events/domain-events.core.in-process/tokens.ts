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
