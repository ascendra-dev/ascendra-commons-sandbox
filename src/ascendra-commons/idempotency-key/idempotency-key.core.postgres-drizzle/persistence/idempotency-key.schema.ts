import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_idempotency_key` table — source of truth for the
 * columns. `PostgresIdempotencyStore` writes exactly these; change this and the
 * store's SQL together, and ship the change as the next numbered file in
 * `../migrations/` (never an edit to a released one).
 *
 * A consuming project never re-exports this into the schema files `drizzle-kit`
 * reads — the DDL comes from `../migrations/`. A project on another stack
 * ignores this folder and provides its own `IdempotencyStore`.
 */
export const idempotencyKeyTable = pgTable(
  'commons_idempotency_key',
  {
    key: text('key').notNull(),
    /** The acting tenant/actor id — so one requester's key can't collide with another's. */
    scope: text('scope').notNull(),
    /** `'pending'` | `'completed'`. */
    status: text('status').notNull().default('pending'),
    /**
     * The current owner's attempt token — set on every claim and on a
     * stale-reclaim. `complete()` is guarded `WHERE claim_id = $x`, so a claim
     * that was reclaimed as stale can no longer write its response over the new
     * owner's.
     */
    claimId: uuid('claim_id').notNull(),
    /** Captured from the handler's real response, never hardcoded (201 for a POST-create, etc.). */
    statusCode: integer('status_code'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /**
     * How many times this `(key, scope)` was reclaimed as stale — incremented
     * atomically in the same `INSERT … ON CONFLICT … DO UPDATE` as the reclaim
     * itself (see `PostgresIdempotencyStore.claim()`). Non-zero is a
     * possible-duplicate signal, not a certain one.
     */
    reclaimCount: integer('reclaim_count').notNull().default(0),
    /**
     * How many `complete()` calls targeting this `(key, scope)` were dropped
     * because the claim they belonged to had already been reclaimed by a newer
     * owner — an **unambiguous** duplicate-processing count. See
     * `PostgresIdempotencyStore.complete()`.
     */
    lateCompleteNoOpCount: integer('late_complete_no_op_count').notNull().default(0),
    /** Repeat requests answered with the saved response — added in batches by `PostgresIdempotencyStore`, never on the request itself. */
    replayCount: integer('replay_count').notNull().default(0),
    /** Repeat requests turned away with a `409` while the claim was pending — batched like `replayCount`. */
    conflictCount: integer('conflict_count').notNull().default(0),
    /** The latest replay or `409`; null if none. */
    lastDuplicateAt: timestamp('last_duplicate_at', { withTimezone: true, mode: 'date' }),
    /** The endpoint's route pattern (`/payments/:id`, never the resolved URL), set when the claim is made. */
    route: text('route'),
    /** Nullable — the caller's correlation id, when threaded through `claim()`, for a cross-module trace. */
    correlationId: text('correlation_id'),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.scope] }),
    /** The 24h cleanup `DELETE … WHERE created_at < now() - interval '24 hours'` scans on this;
     *  also `listClaims()`'s default (unfiltered) newest-first order and `claimHealthSummary()`'s
     *  "oldest retained" lookup. */
    index('commons_idempotency_key_created_at_idx').on(t.createdAt),
    /** `listClaims({ status })` — the support-screen filter for "show me what's stuck pending". */
    index('commons_idempotency_key_status_idx').on(t.status, t.createdAt),
    /** `listClaims({ correlationId })` — cross-module trace lookup. No dedicated cardinality
     *  concern (a correlation id is a handful of rows), same posture `audit-logging` takes. */
    index('commons_idempotency_key_correlation_idx').on(t.correlationId),
    /** `listClaims({ route })` and `claimsByRoute()` over a period (migration 0002). */
    index('commons_idempotency_key_route_idx').on(t.route, t.createdAt),
  ],
);
