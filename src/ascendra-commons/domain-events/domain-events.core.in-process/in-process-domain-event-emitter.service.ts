import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEvent, DomainEventEmitter, EventDeliveryAttempt, EventDeliveryRecorder } from '../domain-events.core';
import { EVENT_DELIVERY_RECORDER, NoopEventDeliveryRecorder } from '../domain-events.core';

const TRANSPORT = 'in-process';

/**
 * Model 1 transport: an in-process emitter (EventEmitter2 via
 * @nestjs/event-emitter), not a message broker. Listeners run in the same
 * process — and, for emitCritical(), synchronously within the producer's own
 * call stack, so if the producer opened a transaction around the emit and
 * rethrows what emitCritical() propagates, that transaction rolls back. This
 * emitter itself never touches a transaction — the rollback decision is the
 * producer's (see domain-event-emitter.ts).
 *
 * Both methods go through emitAsync() internally so sync and async listeners
 * are handled uniformly; only whether the result is awaited/propagated differs.
 * emitCritical() rejects with whichever @OnCriticalEvent() listener fails first;
 * it does not identify or aggregate failures, and every @OnCriticalEvent()
 * listener still runs.
 *
 * IMPORTANT for emitCritical(): a listener subscribed via the plain @OnEvent()
 * decorator will NOT propagate its failure here, no matter which method raised
 * the event — @OnEvent() defaults to { suppressErrors: true }, and NestJS's own
 * EventSubscribersLoader catches, logs, and swallows the throw before it ever
 * reaches this emitter. A listener that must actually fail emitCritical()'s
 * caller (an audit listener, say) needs @OnCriticalEvent() instead of @OnEvent()
 * — see on-critical-event.decorator.ts.
 *
 * DELIVERY LOGGING: both methods also record one `EventDeliveryAttempt` — see
 * `event-delivery-recorder.port.ts`. This is a **delivery** observation only
 * (was there a listener subscribed, did the hand-off happen), never a
 * listener-outcome one: whether a listener's own handler then succeeded is
 * that listener's concern, not recorded here. Recording is best-effort and
 * guarded — a failure to log a delivery never changes what emit()/emitCritical()
 * return to their caller.
 */
@Injectable()
export class InProcessDomainEventEmitter implements DomainEventEmitter {
  private readonly logger = new Logger(InProcessDomainEventEmitter.name);
  private readonly recorder: EventDeliveryRecorder;

  constructor(
    // Explicit @Inject(EventEmitter2), not bare type-based constructor injection —
    // the latter depends on TypeScript's design:paramtypes reflection metadata
    // actually being emitted and read at runtime, which esbuild-based
    // transpilation (vitest, and any consumer building without tsc) does not
    // reliably support. Every other injection in this whole library already uses
    // an explicit token for this exact reason; this was the one exception.
    @Inject(EventEmitter2) private readonly emitter: EventEmitter2,
    @Optional() @Inject(EVENT_DELIVERY_RECORDER) recorder?: EventDeliveryRecorder,
  ) {
    // InProcessDomainEventEmitterModule.forRoot() always binds the token when
    // configured; the fallback keeps `new InProcessDomainEventEmitter(raw)`
    // (tests, ad hoc wiring) working — same pattern as notification's Notifier.
    this.recorder = recorder ?? new NoopEventDeliveryRecorder();
  }

  emit(eventName: string, event: DomainEvent, correlationId?: string): void {
    const listenerCount = this.emitter.listenerCount(eventName);

    // Not awaited by design — but still routed through emitAsync and given a
    // catch, so a listener that forgot to catch its own error becomes a
    // backstopped no-op here rather than an unhandled promise rejection. This
    // backstops listener discipline; a well-behaved listener still catches its
    // own error and records its own failure status rather than relying on
    // this catch existing. The catch still logs, though — a rejection reaching
    // here means either a listener that skipped its own try/catch (rare, since
    // NestJS's EventSubscribersLoader already logs and swallows a plain
    // @OnEvent() listener's own throw before it gets this far — see the class
    // doc comment) or, more usefully, the mismatched-pairing bug this module's
    // README warns about (emit() + @OnCriticalEvent() together: the listener's
    // own throw isn't swallowed by NestJS, so it reaches this catch instead) —
    // exactly the case that previously vanished with zero trace. This is a
    // *listener* outcome, not a delivery one, so it is only logged here, never
    // written to the delivery log (which already recorded 'delivered' below,
    // correctly — the hand-off itself did happen).
    //
    // The outer try/catch is not redundant with .catch(): a listener that throws
    // synchronously (rather than returning a rejected promise) can propagate out of
    // emitAsync() itself, before it has returned a promise for .catch() to attach to.
    try {
      void this.emitter.emitAsync(eventName, event).catch((err) => {
        this.logger.error(
          `emit('${eventName}') — a listener failed. This is swallowed by design (emit() never ` +
            `surfaces a failure to its caller), logged here only so it isn't silently invisible — ` +
            `see this module's README on the emit()+@OnCriticalEvent() mismatch. Event: ${safeStringify(event)}`,
          err instanceof Error ? err.stack : String(err),
        );
      });
      void this.recordDelivery({
        eventName,
        method: 'emit',
        transport: TRANSPORT,
        occurredAt: event.occurredAt,
        listenerCount,
        status: listenerCount === 0 ? 'no_listeners' : 'delivered',
        correlationId,
      });
    } catch (err) {
      this.logger.error(
        `emit('${eventName}') — emitAsync() itself threw synchronously, before dispatching to any ` +
          `listener. Swallowed by design, logged so it isn't silently invisible. Event: ${safeStringify(event)}`,
        err instanceof Error ? err.stack : String(err),
      );
      void this.recordDelivery({
        eventName,
        method: 'emit',
        transport: TRANSPORT,
        occurredAt: event.occurredAt,
        listenerCount,
        status: 'dispatch_failed',
        reason: describeError(err),
        correlationId,
      });
    }
  }

  async emitCritical(eventName: string, event: DomainEvent, correlationId?: string): Promise<void> {
    const listenerCount = this.emitter.listenerCount(eventName);

    let dispatch: Promise<unknown[]>;
    try {
      dispatch = this.emitter.emitAsync(eventName, event);
    } catch (err) {
      // The transport itself broke before reaching any listener — a real delivery
      // failure, distinct from a listener rejecting below (see recordDelivery calls).
      this.logger.error(
        `emitCritical('${eventName}') — emitAsync() itself threw synchronously, before dispatching to ` +
          `any listener. Event: ${safeStringify(event)}`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.recordDelivery({
        eventName,
        method: 'emitCritical',
        transport: TRANSPORT,
        occurredAt: event.occurredAt,
        listenerCount,
        status: 'dispatch_failed',
        reason: describeError(err),
        correlationId,
      });
      throw err;
    }

    // The hand-off itself happened (or there was nobody to hand off to) —
    // recorded now, before waiting on listener outcomes below, because a
    // listener rejecting is not a delivery failure; see the class doc comment.
    await this.recordDelivery({
      eventName,
      method: 'emitCritical',
      transport: TRANSPORT,
      occurredAt: event.occurredAt,
      listenerCount,
      status: listenerCount === 0 ? 'no_listeners' : 'delivered',
      correlationId,
    });

    // emitAsync runs every listener and Promise.all's them, so a synchronous
    // throw or an async rejection from any @OnCriticalEvent() listener surfaces
    // here. Logged before rethrowing unchanged — NestJS's own EventSubscribersLoader
    // does not log a suppressErrors: false failure itself (only the default,
    // suppressErrors: true path logs), so without this, whether the failure is
    // ever traced at all depends entirely on the producer explicitly logging
    // what it catches — and the producer swallowing without logging (a
    // legitimate, documented choice; see domain-event-emitter.ts) would
    // otherwise leave zero trace anywhere. This log does not change the
    // producer's own rollback-or-swallow decision — "a listener failed" still
    // reaches the caller exactly as before, just also written down regardless
    // of what the caller then does with it. It is *not* re-recorded as a
    // delivery failure above — the listener's own outcome is its own module's
    // concern, not this one's.
    try {
      await dispatch;
    } catch (err) {
      this.logger.error(
        `emitCritical('${eventName}') — a critical listener failed. Event: ${safeStringify(event)}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }

  /** Never throws — a delivery-log failure must never change what the caller sees. */
  private async recordDelivery(attempt: EventDeliveryAttempt): Promise<void> {
    try {
      await this.recorder.recordDelivery(attempt);
    } catch (err) {
      this.logger.error(
        `recording the delivery log failed for emit${attempt.method === 'emitCritical' ? 'Critical' : ''}('${attempt.eventName}')`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}

/** Event payloads are already required to be JSON-serializable (see DomainEvent's own doc
 * comment) — this is never expected to throw, but a logging path is the wrong place to
 * risk a second failure over a first one, so it's defensive anyway. */
function safeStringify(event: DomainEvent): string {
  try {
    return JSON.stringify(event);
  } catch {
    return '<event could not be serialized>';
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
