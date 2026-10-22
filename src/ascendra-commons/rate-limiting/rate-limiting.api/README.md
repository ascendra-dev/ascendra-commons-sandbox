# `rate-limiting.api` — HTTP read endpoints for a security/ops screen

Opt-in NestJS controller over `RATE_LIMIT_OBSERVABILITY_PORT`. Stack-agnostic.
**Read-only** — rejections are write-once, recorded only by
`RecordingThrottlerGuard`.

## Endpoints

| Method | Path | → |
|---|---|---|
| GET | `/rate-limits/rejections` | `listRejections(RejectionQuery)` — query params: `route`, `identifier`, `correlationId`, `since`, `until`, `limit`, `cursor`. Returns api-contract Rule 4's cursor shape — `{ data, meta: { nextCursor } }`, newest window first, `nextCursor` absent on the last page — each row is one rejection *window*: route, identifier, limit, `windowStart` (minute), `count`, `firstRejectedAt`, `lastRejectedAt`, `correlationId`. `since`/`until` bound `windowStart`. |
| GET | `/rate-limits/rejections/trace/:correlationId` | every rejection from one request — a cross-module trace. Same cursor shape. |
| GET | `/rate-limits/rejections/catalog` | total rejections per route (the windows' counts summed; optional `since`) — a spike on one route is the "being hammered" signal. |
| GET | `/rate-limits/rejections/top-identifiers` | the identifiers with the most rejections — query params `since`, `route`, `limit` (default 10, max 100). Each: `identifier`, summed `count`, the `routes` it hit, `lastRejectedAt`. `(overflow)` is the sources beyond the recorder's buffer, counted together. |
| GET | `/rate-limits/rejections/volume` | the Overview's "Volume & retention" card — `oldestWindowAt` (how far back the log goes), `rowCount` (stored windows), `tableSizeBytes` (the whole table, every application sharing it), and `perDay`: rejections for each of the past 30 calendar days, zero-filled. Query param `tz` (IANA, default `UTC`) sets where a day starts — an unknown zone is a 400. |

All gated on `@RequiresAction('rate-limit.view')`, and the controller fails
closed: without the global `AuthorizationGuard`, `AuthorizationEnforcedGuard`
answers 500 naming the fix instead of serving the log to anyone signed in.

A bad param is the caller's mistake, never a 500: a `since`/`until` that isn't
an ISO 8601 date, a `tz` that isn't an IANA zone, a `limit` that isn't a positive whole number, a NUL byte in
`route` / `identifier` / a correlation id, or a `cursor` this API didn't return is a `400` naming the param. No tenant scoping — a
rejected, unauthenticated request has no tenant.

## Why this exists

A `429` previously vanished with no trace anywhere — if a public,
unauthenticated endpoint (a payment link, most concretely) is actually being
hammered, nothing tells you. This module is the read surface over what
`RecordingThrottlerGuard` now records. Cross-reference with
`payment-link-security.api`'s own resolution log for the same window — a
source hitting both is a strong signal, not two unrelated blips.

## Wiring

```typescript
import { RateLimitingApiModule } from '.../rate-limiting.api';
import { PostgresRateLimitObservabilityModule } from '.../rate-limiting.core.postgres-drizzle';

@Module({
  imports: [
    RateLimitingApiModule.forRoot({
      imports: [PostgresRateLimitObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required
  ],
})
export class AppModule {}
```

## Depends on

`rate-limiting.core` (the port + DTOs), and `authorization.core` (guard,
`@RequiresAction`). Never a stack adapter. The frontend belongs in
`ascendra-commons-ui`.
