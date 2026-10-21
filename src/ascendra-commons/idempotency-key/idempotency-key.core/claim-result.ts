import type { CachedResponse } from './cached-response.interface';

/**
 * `claimId` (on the `'claimed'` result) is the attempt's ownership token — the
 * interceptor threads it back into `store.complete()`, so a claim that was
 * later reclaimed as stale (its `claimId` overwritten by the new owner) can no
 * longer write its own response over the current owner's. See
 * `PostgresIdempotencyStore`.
 *
 * `reclaimedStale` distinguishes a brand-new claim from one that won because a
 * *previous* claim on this same `(key, scope)` went stale (its owner presumed
 * abandoned past `staleAfterSeconds`). Both return `'claimed'` — the caller
 * proceeds identically either way — but a reclaim is the exact scenario
 * `IdempotencyStoreOptions.staleAfterSeconds`'s doc comment warns about: if the
 * original owner was in fact still running, this is a genuine duplicate
 * execution, reintroduced by the safety mechanism itself. Surfaced so it isn't
 * invisible (`IdempotencyInterceptor` logs it; a stack adapter can count it) —
 * see `idempotency-key.core.postgres-drizzle`'s observability service.
 */
export type ClaimResult =
  | { status: 'claimed'; claimId: string; reclaimedStale: boolean } // this request is first — proceed, then complete() with claimId
  | { status: 'completed'; response: CachedResponse } // already finished — return the cached response
  | { status: 'in_progress' }; // a concurrent duplicate, still running elsewhere
