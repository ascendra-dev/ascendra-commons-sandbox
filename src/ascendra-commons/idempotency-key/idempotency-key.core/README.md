# `idempotency-key.core` — the port + enforcement

Protects against the *same* request being retried — a payer double-clicking
"Pay," a network retry resubmitting an unchanged request. Distinct from
optimistic locking (which protects against a *different* request racing stale
data).

There is a real Model 1 / Model 2 seam — the store backend — so each is its own
package:

- **`idempotency-key.core.postgres-drizzle`** (Model 1) — `PostgresIdempotencyStore`:
  a `commons_idempotency_key` table, one atomic `INSERT … ON CONFLICT …` claim.
- **`idempotency-key.core.redis`** (Model 2) — a stub that throws
  `RedisIdempotencyStoreNotImplementedError`; the seam is real, the transport
  isn't built.

## What's in here

| Piece | Purpose |
|---|---|
| `IdempotencyStore` (`idempotency-store.port.ts`) | `claim(key, scope, context?)` — `context` is `{ correlationId?, route? }` → `claimed` / `completed` / `in_progress`; `complete(key, scope, claimId, response)`. An **atomic** claim — check-then-act is unsafe. **No implementation here.** |
| `ClaimResult` | The `'claimed'` result carries a `claimId` (an ownership token the interceptor threads back into `complete()`, so a claim reclaimed as stale can't overwrite the new owner's cached response) and a `reclaimedStale` flag — see "Observability" below. |
| `IdempotencyScopeResolver` + `ActorScopeResolver` | `scope` = the acting tenant/actor id, so one tenant's key can't collide with another's. `ActorScopeResolver` (reads `request.actor`) is the default; an anonymously-reachable endpoint needs its own. |
| `IdempotencyInterceptor` | Enforcement — reads the `Idempotency-Key` header (1–255 printable ASCII characters, else a `400` before anything is claimed), claims, caches the handler's real status code (never hardcoded), replays a cached error *as* that error, and only emits the response after `complete()`'s write lands. Also reads `x-correlation-id` (by convention, not a dependency — see "Observability") and logs a warning when `reclaimedStale`. |
| `IdempotencyObservabilityPort` (`idempotency-observability.port.ts`) | Read-only reporting — `getClaim`, `getClaimResponse` (the saved body, kept out of every claim record — it can hold personal data), `listClaims`, `claimHealthSummary({ since? })`, `claimsByRoute({ since? })`. Implemented by a stack adapter, consumed by `idempotency-key.api`. |
| `IdempotencyModule.forRoot({ storeToken, scopeResolverToken?, imports })` | Pure token wiring. Does **not** apply the interceptor — the consumer opts in per-endpoint with `@UseInterceptors(IdempotencyInterceptor)`. |

## `applicationId` / `tenantId`

No `applicationId` — a claim never leaves the store it's made in. No separate
`tenantId` — `scope` already carries whatever identifies the requester (a
tenant id, an actor id, or a signed-link token's identity for an anonymous
caller), and is more flexible than a bare `tenantId` field.

## Observability (2026-09-12) — closing two blind spots, not just adding a read screen

Before this pass, two facts about a claim were structurally invisible, not
merely unobserved: whether `claim()`'s `'claimed'` result was a fresh key or a
**reclaim of a still-possibly-running claim** (the exact scenario
`IdempotencyStoreOptions.staleAfterSeconds`'s doc comment warns can silently
reintroduce a duplicate), and whether a `complete()` call **no-op'd** because
its claim had already been reclaimed out from under it (the moment that
duplicate actually happens). Both are now surfaced:

- `ClaimResult.claimed.reclaimedStale: boolean` — `IdempotencyInterceptor` logs
  a warning when true; a stack adapter can count it.
- `complete()`'s reference Postgres implementation now detects and counts its
  own 0-row no-op — see `idempotency-key.core.postgres-drizzle`'s README.

2026-10-21: the duplicates the pattern absorbs are counted too — a replay of
the saved response and a `409` on an in-progress claim (`replayCount`,
`conflictCount`, `lastDuplicateAt` on the claim record) — and every claim
records its endpoint's route pattern. A store must count them without adding
I/O to the duplicate's request (the reference adapter buffers them).

`ClaimContext` is optional on `claim()`. Its `route` is the matched route
pattern (Express `route.path`, Fastify `routeOptions.url` / `routerPath`, else
`Controller.handler`) — never the resolved URL. Its `correlationId` is read by
`IdempotencyInterceptor` off the `x-correlation-id` header, kept only when
well-formed (`[A-Za-z0-9._:-]`, ≤128 chars — the header is caller-controlled),
**by convention, not by depending on `audit-logging`** (this module stays self-contained; the two
naturally agree on the same header when both are wired in one app) — so a
stack adapter can join a claim to the same id in `commons_audit_event` /
`commons_notification_delivery` / `commons_domain_events_delivery` /
`commons_jobs_job_run` for a cross-module trace.

See `idempotency-key.core.postgres-drizzle` for the reference implementation
and `idempotency-key.api` for the read surface.

## Wiring

```typescript
IdempotencyModule.forRoot({
  storeToken: POSTGRES_IDEMPOTENCY_STORE,
  imports: [
    PostgresIdempotencyStoreModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION,
      staleAfterSeconds: 45,   // measured from THIS project's slowest enforced endpoint's real p99, never copied
      imports: [DatabaseModule],
    }),
  ],
})
```

```typescript
@Post('invoices')
@UseInterceptors(IdempotencyInterceptor)
async createInvoice(@Body() dto: CreateInvoiceDto) { /* ... */ }
```

## Depends on

`@nestjs/common`, `@nestjs/core`, `rxjs`. No database driver.
