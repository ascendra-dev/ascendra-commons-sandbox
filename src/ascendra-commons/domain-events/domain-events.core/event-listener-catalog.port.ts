/** One `@OnEvent()`/`@OnCriticalEvent()` binding discovered in the running application. */
export interface EventListenerCatalogEntry {
  eventName: string;
  /** The owning provider/controller class name — best-effort; `'(anonymous)'` if the instance has none. */
  listenerClass: string;
  listenerMethod: string;
  /** `true` for `@OnCriticalEvent()` (`suppressErrors: false`); `false` for a plain `@OnEvent()`. */
  critical: boolean;
}

/**
 * The wiring map — "what listens to what," independent of whether the event
 * has ever actually fired. Complements `EventDeliveryObservabilityPort`
 * (which reports what *has* happened) with what the code *says* should
 * happen; cross-referencing the two catches both an event nobody listens to
 * and a listener registered for an event name that's never emitted (a likely
 * typo).
 *
 * Only `domain-events.core.in-process` can implement this — it works by
 * scanning the running app's own `@OnEvent()`/`@OnCriticalEvent()` decorator
 * metadata (see its `domain-event-listener-catalog.service.ts`), which only
 * exists for listeners living in *this* process. A broker's listeners live in
 * other services' codebases and are not discoverable this way — there is no
 * Model 2 implementation of this port, and none is planned; see
 * `domain-events.core.broker`'s README.
 */
export interface EventListenerCatalogPort {
  /** Every discovered binding, one row per (event, listener method) pair. */
  list(): Promise<EventListenerCatalogEntry[]>;
}
