/**
 * One `emit()` / `emitCritical()` call, as the transport observed it — **delivery
 * only**, never a listener's own outcome. "Delivered" means the transport handed
 * the event off to whatever was subscribed at that moment; it says nothing about
 * what a listener then did with it. Whether the audit write succeeded or the
 * notification actually sent is that listener's own module's concern (its own
 * delivery log / observability), not this one's — see the module README's
 * "What this does and doesn't observe" section.
 */
export interface EventDeliveryAttempt {
  eventName: string;
  /** Which emitter method raised it — `emitCritical()`'s own listener-failure contract is unchanged by this; see the port doc. */
  method: 'emit' | 'emitCritical';
  /** Which transport handled it — `'in-process'` today; a future broker stamps its own. */
  transport: string;
  /** The business fact's own time (`event.occurredAt`), not when this row was written. */
  occurredAt: Date;
  /** `EventEmitter2.listenerCount(eventName)`, read before dispatch — how many subscribers existed at that moment. */
  listenerCount: number;
  /**
   * `'delivered'` — at least one listener was subscribed and the hand-off happened.
   * `'no_listeners'` — nobody was subscribed; the event fired into a void (a wiring gap).
   * `'dispatch_failed'` — the transport itself broke before reaching any listener
   * (e.g. `EventEmitter2.emitAsync()` throwing synchronously) — genuinely rare,
   * and distinct from a listener rejecting, which is **not** a delivery failure.
   */
  status: 'delivered' | 'no_listeners' | 'dispatch_failed';
  /** Set only for `dispatch_failed` — the transport-level error's message. */
  reason?: string;
  /** The caller-supplied correlation id, when threaded through `emit()`/`emitCritical()`. */
  correlationId?: string;
}

/**
 * The delivery-log port. A transport (today, only `InProcessDomainEventEmitter`)
 * calls `recordDelivery()` once per `emit()`/`emitCritical()` call. **Best-effort
 * by contract: an implementation must not throw** — a failure to log a delivery
 * must never change the emitter's own outcome. The transport also guards the
 * call itself (belt-and-braces, the same pattern `notification`'s `Notifier`
 * uses for its own delivery recorder).
 *
 * Bound under `EVENT_DELIVERY_RECORDER`; `NoopEventDeliveryRecorder` (this
 * package) is the default when nothing is configured.
 */
export interface EventDeliveryRecorder {
  recordDelivery(attempt: EventDeliveryAttempt): Promise<void>;
}
