# `idempotency-key.api` — HTTP read endpoints for a support/ops screen

Opt-in NestJS controller over `IDEMPOTENCY_OBSERVABILITY_PORT`. Stack-agnostic
— it never imports a stack adapter; it's wired to one at the vertical via
`imports`. **Read-only** — claims are write-once from this API's point of view
(only `IdempotencyStore` writes them), so there's no mutation surface.

## Endpoints

| Method | Path | → |
|---|---|---|
| GET | `/idempotency-keys` | `listClaims(ClaimQuery)` — query params: `status`, `scope`, `route`, `correlationId`, `since`, `until`, `limit`, `cursor`. Returns `{ data, meta: { nextCursor } }` (api-contract Rule 4), newest first. A malformed date or `limit`, or a cursor this endpoint never returned, is a `400`. |
| GET | `/idempotency-keys/trace/:correlationId` | every claim raised under one correlation id, as `{ data, meta }` — a cross-module trace, joinable with `audit-logging.api` / `notification.api` / `background-jobs.api` / `domain-events.api`'s own trace endpoints on the same id. |
| GET | `/idempotency-keys/health` | `claimHealthSummary({ since? })` — pending/completed/reclaimed counts, the duplicates absorbed (`replayTotal`, `conflictTotal`), the unambiguous `lateCompleteNoOpTotal`, and how far back the retained window goes. `?since=` limits it to claims made since then. The number to check when `staleAfterSeconds` is suspected of being too low. |
| GET | `/idempotency-keys/routes` | `claimsByRoute({ since? })` — claims, replays, conflicts, reclaims and late completes per route pattern, most duplicates first. |
| GET | `/idempotency-keys/:scope/:key` | one claim — the support-ticket lookup ("why did this submission 409 or replay"). The saved response's status code and size, never its body. |
| GET | `/idempotency-keys/:scope/:key/response` | the saved response — `{ statusCode, body }`, exactly what a retry is replayed — gated on **`idempotency.view-response`**. Null unless the claim is completed. |

All but the last gated on `@RequiresAction('idempotency.view')`.

**The saved body is a separate grant.** It's whatever the endpoint returned —
a payment's payer, an invoice's customer — so no list, trace or claim record
carries it (only `statusCode` and `responseBytes`). `idempotency.view-response`
(`IDEMPOTENCY_ACTIONS.VIEW_RESPONSE`) unlocks it one claim at a time; grant it
to the few who need to answer "what exactly did they get back?". The controller also carries
`@UseGuards(AuthorizationEnforcedGuard)`: if the global `AuthorizationGuard`
isn't wired, every endpoint fails closed with a 500 naming the fix — never
every signed-in user reading saved responses.

## No tenant scoping — read this before wiring

Unlike `audit-logging.api`, this module does **not** auto-restrict a caller to
their own tenant. `scope` is opaque to `idempotency-key` — whatever the
consuming app's `IdempotencyScopeResolver` returns (usually a tenant/actor id,
but not guaranteed to line up with `Actor.tenantId`), so there's no safe
generic way to enforce "your own scope only" the way audit-logging enforces
`tenantId`. **Grant `idempotency.view` only to an ops/support persona** that's
meant to see every tenant's claims — the same posture `background-jobs.api`
takes for jobs (which also have no `tenantId`).

## Wiring

```typescript
import { IdempotencyApiModule } from '.../idempotency-key.api';
import { PostgresIdempotencyObservabilityModule } from '.../idempotency-key.core.postgres-drizzle';

@Module({
  imports: [
    IdempotencyApiModule.forRoot({
      imports: [PostgresIdempotencyObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] })],
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required
  ],
})
export class AppModule {}
```

## Depends on

`idempotency-key.core` (the port + DTOs), and `authorization.core` (guard,
`@RequiresAction`). Never a stack adapter. The frontend belongs in
`ascendra-commons-ui`.
