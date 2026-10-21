import type { CachedResponse } from './cached-response.interface';

/** One `commons_idempotency_key` row, mapped and typed — what a support/ops screen renders. */
export interface IdempotencyClaimRecord {
  key: string;
  /** The acting tenant/actor id (or whatever the app's `IdempotencyScopeResolver` returns). */
  scope: string;
  status: 'pending' | 'completed';
  /** The saved response's status code, once `status = 'completed'` — what a retry is replayed. */
  statusCode: number | null;
  /**
   * The saved response body's size in bytes, once completed. The body itself is never part of a claim record — it can
   * hold personal data, so it is read separately (`getClaimResponse`) behind its own permission.
   */
  responseBytes: number | null;
  createdAt: Date;
  /**
   * How many times a request for this `(key, scope)` was reclaimed as stale
   * (its owner presumed abandoned). Non-zero here doesn't by itself prove a
   * duplicate ran — the original owner may genuinely have finished or crashed
   * — but it's the number to look at when `staleAfterSeconds` is suspected of
   * being set too low.
   */
  reclaimCount: number;
  /**
   * How many `complete()` calls targeting this `(key, scope)` were dropped
   * because the claim they were completing had already been reclaimed by a
   * newer owner. **This one is unambiguous**: it means a request's result was
   * silently discarded because the safety window expired while it was still
   * in flight — the exact duplicate-processing failure mode
   * `staleAfterSeconds`'s doc comment describes.
   */
  lateCompleteNoOpCount: number;
  /**
   * How many repeat requests got this claim's saved response replayed — the duplicates the pattern absorbed. Counted
   * in memory and added every few seconds, so it can trail the live count briefly.
   */
  replayCount: number;
  /** How many repeat requests arrived while this claim was still pending and got a `409`. Counted like `replayCount`. */
  conflictCount: number;
  /** When the last replay or `409` for this claim happened; null if none has. */
  lastDuplicateAt: Date | null;
  /** The endpoint's route pattern, recorded when the claim was made; null for a claim made before routes were recorded. */
  route: string | null;
  /** The caller's correlation id, when threaded through `claim()`, for a cross-module trace. */
  correlationId: string | null;
}

export interface ClaimQuery {
  status?: 'pending' | 'completed';
  scope?: string;
  /** Exact route pattern, as recorded. */
  route?: string;
  correlationId?: string;
  /** Inclusive lower bound on `createdAt`. */
  since?: Date;
  /** Exclusive upper bound on `createdAt`. */
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. Anything else throws `InvalidIdempotencyCursorError`. */
  cursor?: string;
}

export interface ClaimPage {
  /** Newest first. */
  claims: IdempotencyClaimRecord[];
  /** Present only when more rows match — pass back as `ClaimQuery.cursor`. */
  nextCursor?: string;
}

/**
 * The health numbers over claims made since `since`, or over whatever the store still retains when it's omitted (rows
 * are pruned — see the adapter README — so this is "recently," not "all time").
 */
export interface ClaimHealthSummary {
  pendingCount: number;
  completedCount: number;
  /** Claims with `reclaimCount > 0` — a possible-duplicate signal (see `IdempotencyClaimRecord.reclaimCount`). */
  reclaimedCount: number;
  /** Sum of every row's `lateCompleteNoOpCount` — an unambiguous duplicate-processing count. */
  lateCompleteNoOpTotal: number;
  /** Sum of every row's `replayCount` — repeat requests answered with a saved response. */
  replayTotal: number;
  /** Sum of every row's `conflictCount` — repeat requests turned away with a `409` while the first was running. */
  conflictTotal: number;
  totalCount: number;
  /** The oldest row currently retained — how far back the store can look, whatever `since` asked for. */
  oldestRetainedAt: Date | null;
}

export interface ClaimHealthQuery {
  /** Inclusive lower bound on a claim's `createdAt`. Omit for everything retained. */
  since?: Date;
}

/** One endpoint's claims and duplicates — `claimsByRoute()`'s row. */
export interface RouteClaimCount {
  /** The route pattern; null groups claims made before routes were recorded. */
  route: string | null;
  claims: number;
  replays: number;
  conflicts: number;
  /** Claims with `reclaimCount > 0` on this route. */
  reclaimed: number;
  lateCompleteNoOps: number;
}

/**
 * Read-only reporting over the claim table for a support/ops screen. Bound
 * under `IDEMPOTENCY_OBSERVABILITY_PORT` by a stack adapter; consumed by
 * `idempotency-key.api`. Never mutates — claims are written only by
 * `IdempotencyStore`.
 */
export interface IdempotencyObservabilityPort {
  getClaim(key: string, scope: string): Promise<IdempotencyClaimRecord | null>;
  /**
   * The saved response — status code and body — exactly as a retry would be replayed; null unless the claim is
   * completed. Kept apart from `getClaim` because the body can hold personal data: `idempotency-key.api` gates it on
   * its own action.
   */
  getClaimResponse(key: string, scope: string): Promise<CachedResponse | null>;
  /** Claims, newest first, keyset-paginated. */
  listClaims(query?: ClaimQuery): Promise<ClaimPage>;
  claimHealthSummary(query?: ClaimHealthQuery): Promise<ClaimHealthSummary>;
  /** Per-route counts over claims made since `since` (everything retained when omitted), most duplicates first. */
  claimsByRoute(query?: ClaimHealthQuery): Promise<RouteClaimCount[]>;
}
