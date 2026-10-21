# `idempotency-key.core.postgres-drizzle` — Model 1

The atomic claim over a `commons_idempotency_key` table.

## Layout

| File | |
|---|---|
| `persistence/idempotency-key.schema.ts` | Drizzle `pgTable` — source of truth for the columns |
| `migrations/` | the DDL + indexes, numbered — **never edited once released**; a schema change is the next file |
| `persistence/sql-executor.ts` | the minimal db shape (`{ rows }` only) |
| `postgres-idempotency-store.ts` | `IdempotencyStore` — `claim()` / `complete()` |
| `duplicates/postgres-idempotency-duplicate-counter.ts` | counts replays and `409`s in memory, adds them to the claim rows every `flushIntervalMs` |
| `postgres-idempotency-store.module.ts` | `forRoot({ sqlExecutorToken, staleAfterSeconds, duplicateCounter?, imports })` → `POSTGRES_IDEMPOTENCY_STORE` |
| `observability/postgres-idempotency-observability.service.ts` | `IdempotencyObservabilityPort` — `getClaim()` / `listClaims()` / `claimHealthSummary()` / `claimsByRoute()`, read-only |
| `observability/postgres-idempotency-observability.module.ts` | `forRoot({ sqlExecutorToken, imports })` → the core `IDEMPOTENCY_OBSERVABILITY_PORT` token |

## The claim

`claim()` is **one** `INSERT … ON CONFLICT DO UPDATE … WHERE (status='pending' AND created_at < now()-stale) … RETURNING claim_id`:

- **fresh key** → inserts, one row → `{ claimed, claimId }`
- **stale abandoned claim** → the `WHERE` matches, updates (new `claim_id`, `created_at`), one row → `{ claimed, claimId }`
- **recent pending / completed** → the `WHERE` doesn't match, zero rows → a fallback `SELECT` classifies it `in_progress` / `completed`
- **row deleted mid-race** (a cleanup job) → a race-safe `INSERT … ON CONFLICT DO NOTHING RETURNING` re-claim (never a plain `INSERT` that could PK-violate under a concurrent re-claim)

`rows.length` is the "did I win" check, not `rowCount` — `RETURNING` guarantees
the rows array, and `rowCount` isn't reliably populated across `pg` /
`postgres.js` for `ON CONFLICT` statements.

**Telling a fresh claim from a reclaim, atomically:** the `RETURNING` clause
also carries `(xmax = 0) as inserted` — a standard Postgres idiom (`xmax` is
the deleting-transaction id every row version carries; `0` means the row was
never updated). A plain `INSERT` produces `xmax = 0`; the `DO UPDATE` reclaim
branch produces a new row version with `xmax != 0`. One statement, no second
query, no new race — `ClaimResult.claimed.reclaimedStale` falls straight out
of it. `reclaim_count = reclaim_count + 1` is incremented in that same `DO
UPDATE SET`, so the count can never itself race the reclaim it's counting.

## `claim_id` — the ownership guard, now observed instead of silent

Every claim carries a fresh `claim_id`. `complete(key, scope, claimId, response)`
is guarded `WHERE claim_id = $claimId` **and returns `key`**, so a 0-row result
is detectable. So if a still-in-flight claim is reclaimed as stale (`claimId`
overwritten by the new owner), the original claimer's eventual `complete()` is
a **0-row no-op** — it can't write its response over the current owner's cached
one — and, as of 2026-09-12, that no-op is logged (`Logger.warn`) and counted
(`late_complete_no_op_count`, best-effort, guarded so a counting failure never
surfaces past `complete()`'s own contract) instead of vanishing without a trace.

This does **not** stop the duplicate side-effect — once a live claim is reclaimed
by time, both requests run, and nothing at this layer can prevent that. Set
`staleAfterSeconds` above the real p99 of the slowest enforced endpoint (`forRoot`
throws on `<= 0`). The guard just keeps the cache consistent with what the
current owner's client actually saw. `late_complete_no_op_count` is the
**unambiguous** signal that this actually happened — see
`IdempotencyObservabilityPort.claimHealthSummary()`'s `lateCompleteNoOpTotal`,
exposed by `idempotency-key.api`'s `GET /idempotency-keys/health`.

## Counting duplicates — no I/O on the duplicate's request

A duplicate `claim()` answers (a replay, a `409`) already costs two queries —
the claim attempt and the read that classifies it. It must cost no more: a
client hammering one key would otherwise queue up on that row's lock.
`PostgresIdempotencyDuplicateCounter` counts it in memory and, every
`flushIntervalMs` (10s), adds the counts onto the claim rows in one
`UPDATE … FROM (VALUES …)` per 1,000 claims — `replay_count`,
`conflict_count`, `last_duplicate_at = greatest(…)`. So several instances add
into the same rows, and a flood on one key is one row update per flush.

Best-effort, like rate-limiting's recorder: a failed flush is logged and its
counts dropped, never retried; the buffer is flushed on shutdown. Once
`maxBufferedKeys` (10,000) claims have duplicates within one interval, further
claims' duplicates are dropped — **and the drop is logged**, never silent. A
count for a claim pruned before the flush is a no-op.

`PostgresIdempotencyStoreModule.forRoot({ duplicateCounter: { flushIntervalMs, maxBufferedKeys } })`.

Migration `0002` adds the three count columns and `route` (the route pattern,
set by the claim) with an index on `(route, created_at)` for the per-route
breakdown and filter.

## Cleanup

A bare `@Cron()` handler in the consuming project:
`DELETE FROM commons_idempotency_key WHERE created_at < now() - interval '24 hours'`
— safe under concurrent execution (Postgres serializes it; no `IdempotentJobRunner`
needed). The `commons_idempotency_key_created_at_idx` index keeps that off a full
scan. **Note:** this 24h *completed-record* expiry is a separate number from
`staleAfterSeconds` (the *pending-claim* abandonment window) — don't conflate them.
It's also why `PostgresIdempotencyObservabilityService.claimHealthSummary()` is a
*recent* health check, not an all-time one — `oldestRetainedAt` says exactly how
far back it actually looks.

## Observability — delivery only, no `application`

`PostgresIdempotencyObservabilityService` is read-only, no admin surface (claims
are written only by `PostgresIdempotencyStore`), and unscoped by `application` —
the module has none (see the root README). `correlation_id`, when the caller
threaded one through `claim()`, is the cross-module join key with
`commons_audit_event` / `commons_notification_delivery` /
`commons_domain_events_delivery` / `commons_jobs_job_run`.

## Depends on

`idempotency-key.core`, `@nestjs/common`, `drizzle-orm` (`drizzle-orm/pg-core`).
