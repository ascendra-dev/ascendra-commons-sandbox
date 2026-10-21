import type { CachedResponse } from './cached-response.interface';
import type { ClaimResult } from './claim-result';

/**
 * What the caller knows about the request making the claim — plumbing for observability only, never part of `scope`
 * or the cache key. Recorded when the claim is first made.
 */
export interface ClaimContext {
  /** The ambient request/trace id, when the caller has one — joins a claim to the same id in other modules' tables. */
  correlationId?: string;
  /** The endpoint's route pattern (`/payments/:id`, never the resolved URL) — what an ops screen groups claims by. */
  route?: string;
}

/**
 * An atomic claim, not check-then-act — a plain `get()` then `save()` is not
 * safe even against one shared table: two requests carrying the same key
 * arriving close together can both see "nothing cached yet" before either has
 * written its own entry. The claim itself must be atomic at the store level.
 *
 * `.core` ships no implementation — wire `POSTGRES_IDEMPOTENCY_STORE`
 * (`idempotency-key.core.postgres-drizzle`, Model 1) or your own.
 * `idempotency-key.core.redis` is the placeholder for Model 2 (throws until
 * built).
 *
 * `complete()` takes the `claimId` from the `'claimed'` result — an evicted
 * (reclaimed-as-stale) claimer's `complete()` then no-ops instead of
 * overwriting the current owner's cached response. That no-op is itself worth
 * knowing about — see `idempotency-key.core.postgres-drizzle`'s
 * `PostgresIdempotencyStore` for how the reference adapter surfaces it.
 *
 * `context` is optional — the correlation id (the same id `JobTrigger.trigger()`
 * and `DomainEventEmitter.emit()` take, so a stack adapter can join a claim to
 * `commons_audit_event` / `commons_notification_delivery` /
 * `commons_domain_events_delivery` for a cross-module trace) and the route
 * pattern. Plumbing only — never part of `scope` or the cache key.
 *
 * A store may also count the duplicates `claim()` answers — a replayed
 * `'completed'` and a `'in_progress'` 409 — for the observability port, but
 * must never add I/O to that path to do it (see `PostgresIdempotencyStore`).
 */
export interface IdempotencyStore {
  claim(key: string, scope: string, context?: ClaimContext): Promise<ClaimResult>;
  complete(key: string, scope: string, claimId: string, response: CachedResponse): Promise<void>;
}
