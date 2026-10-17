import { DomainEvent } from './domain-event.interface';

/**
 * The single emission surface business logic depends on — an interface, not a
 * class, so the transport underneath can be chosen at module-import time
 * (DomainEventsModule.forRoot({ transport })) rather than being baked in.
 *
 * Two methods, differing only in whether the producer hears about a failure:
 *
 * - emit(): fire-and-forget. Never awaited, never surfaces anything to the
 *   caller — a listener that throws (even one that forgot to catch its own
 *   error) is backstopped internally. For subscribers like notifications, where
 *   a dropped delivery is a minor, recoverable inconvenience.
 * - emitCritical(): awaited. If the receiver fails, or ANY listener subscribed
 *   via @OnCriticalEvent() throws or rejects, emitCritical() rejects and that
 *   error reaches the producer. For subscribers like audit logging, where a
 *   silently dropped record is unacceptable.
 *
 * WHO DECIDES ROLLBACK: the producer, always. This emitter never touches a
 * transaction and never rolls anything back. emitCritical() only propagates the
 * failure; the producer catches it and decides — rethrow (letting its own
 * transaction boundary roll back) or swallow (commit anyway). "emitCritical"
 * names the producer's intent to *be told*, not an automatic rollback.
 *
 *   try {
 *     await this.domainEvents.emitCritical(InvoiceEvents.STATUS_CHANGED, event);
 *   } catch (err) {
 *     // a listener failed. rethrow to roll back, or log + continue to commit.
 *     throw err;
 *   }
 *
 * The producer does not know, and should not need to know, which listeners
 * exist. "A listener failed" is the whole signal — emitCritical() does not
 * distinguish which one or aggregate multiple failures; it rejects with one of
 * them. All @OnCriticalEvent() listeners still run regardless. A listener that
 * wants the producer to branch on *why* it failed should throw a distinguishable
 * error type of its own.
 *
 * A plain @OnEvent() listener's failure never reaches the producer, even under
 * emitCritical() — NestJS's EventSubscribersLoader catches and logs it
 * (suppressErrors defaults to true). Only @OnCriticalEvent() opts a listener
 * into failing emitCritical(). See on-critical-event.decorator.ts.
 *
 * TRANSPORT NOTE: under the in-process transport, an @OnCriticalEvent() listener
 * runs synchronously within the producer's call stack, so rethrowing the caught
 * error rolls back a transaction the producer opened around the emit. A broker
 * transport cannot offer that (the subscriber is in another process) — there, an
 * emitCritical() rejection would mean the event could not be durably enqueued,
 * not that a handler failed. See broker-domain-event-emitter.service.ts.
 *
 * Both methods are async-shaped from the start (emitCritical returns
 * Promise<void>; emit returns void but dispatches asynchronously) — the same
 * reasoning `authorization/authorizer.ts` gives for its can() being
 * Promise<boolean> before any async implementation exists: a later transport is
 * then a true drop-in, not a breaking change to every call site.
 *
 * Call sites inject this via the DOMAIN_EVENT_EMITTER token, never a concrete
 * class:
 *
 *   constructor(
 *     @Inject(DOMAIN_EVENT_EMITTER) private readonly domainEvents: DomainEventEmitter,
 *   ) {}
 *
 * CORRELATION ID: an optional third argument on both methods — the ambient
 * request/trace id, when the caller has one, the same shape `JobTrigger.trigger()`
 * and `NotificationRequest.correlationId` already take. Threaded into the
 * delivery log (see `event-delivery-recorder.port.ts`) so a delivery can be
 * joined to the same id in `commons_jobs_job_run` / `commons_audit_event` /
 * `commons_notification_delivery` for a cross-module trace. Not stored on the
 * event payload itself — the same reasoning `tenantId` isn't (see this
 * package's README): it's plumbing to the delivery log, not a fact of what
 * happened, and it must cross a process boundary independently of whatever the
 * event class itself carries.
 */
export interface DomainEventEmitter {
  /** Fire-and-forget. Never awaited, never surfaces a listener failure to the caller. */
  emit(eventName: string, event: DomainEvent, correlationId?: string): void;

  /**
   * Awaited. Rejects if the receiver fails or any @OnCriticalEvent() listener
   * throws/rejects — the producer catches it and decides whether to roll back.
   * Does not identify or aggregate failures.
   */
  emitCritical(eventName: string, event: DomainEvent, correlationId?: string): Promise<void>;
}
