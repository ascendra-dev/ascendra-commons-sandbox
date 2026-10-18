# `audit-logging.api` — HTTP read endpoints for a compliance / ops screen

Opt-in NestJS controller over the `AUDIT_EVENT_READER` port. Stack-agnostic —
it never imports a stack adapter; it's wired to one at the vertical via `imports`.
**Read-only** — audit records are write-once, so there's no mutation surface and
no audit-emitter.

## Endpoints

| Method | Path | → |
|---|---|---|
| GET | `/audit/events` | `find(AuditQuery)` — query params: `entityType`, `entityId`, `tenantId`, `actor`, `action`, `correlationId`, `occurredAfter`, `occurredBefore`, `limit`, `cursor`. Returns api-contract.md's cursor list shape: `{ data, meta: { nextCursor } }` (records newest-first; `nextCursor` omitted on the last page), mapped from the core's `AuditQueryResult` in the controller. |
| GET | `/audit/events.csv` | api-contract.md Rule 9's list export: the same filters as `/audit/events` (no `limit`/`cursor`), **every** matching row up to `forRoot({ exportMaxRows })` (default 100,000), streamed as `text/csv` newest-first. `occurredBefore` is pinned to the request time; a capped `countUpTo()` runs first so `X-Export-Row-Count` / `X-Export-Truncated` / `X-Export-Limit` and a timestamped `Content-Disposition` filename go out before the body. A larger result is truncated, not rejected. No async export job (that writes to `file-storage`) is built here. |
| GET | `/audit/events/:id` | `findOne(id)` — one record plus its server-computed `diff` (`AuditEventDetail`, via `diffFields`): one entry per changed leaf, nested objects as dot paths (`address.street`), arrays compared whole. 404s (never leaks existence) for a missing or cross-tenant id. |
| GET | `/audit/entities/:type/:id/history` | one entity's full audit history, paginated. Same `{ data, meta: { nextCursor } }` shape as `/audit/events`. |
| GET | `/audit/trace/:correlationId` | every record from one request / job run — a cross-module trace. Same `{ data, meta: { nextCursor } }` shape as `/audit/events`. |
| GET | `/audit/actors/:actor/activity` | `summarizeActor(actor, query)` — counts by (entity type, action), first/last seen, distinct tenants touched. Query params: `occurredAfter`, `occurredBefore`. |
| GET | `/audit/stats/overview` | `overviewStats(window, tenantFilter)` — the Overview's KPI row and volume chart: `perDay` (every UTC day in the window, zero-filled) and `kpis` (records in the past 24 h / 7 d, distinct actors / entity types in the past 30 d — each with `deltaPct` vs. the equal period before, `null` when that period was empty). Query params: `window` (e.g. `'30d'`, default 30 days), `tenantId` (platform admin only). |
| GET | `/audit/stats/top-actions` | `topActions(window, tenantFilter)` — the Overview's Top actions: the 10 most frequent (entity type, action) pairs, with distinct actors. Same params; `window` defaults to 7 days. |
| GET | `/audit/retention` | `retention(tenantFilter)` — the Retention & Volume screen: `oldestRecordAt`, `rowCount`, `tableSizeBytes` (the whole table's on-disk size; `null` when scoped to one tenant) and `perMonth` (every UTC month since the oldest record, zero-filled). Read-only — records are kept indefinitely; there is no deletion. Query param: `tenantId` (platform admin only). |
| GET | `/audit/catalog` | The app's audit vocabulary from `forRoot({ catalog })` (required) — `{ entityType, actions }[]`, a bare array (api-contract.md Rule 4's bounded case). Not tenant-scoped (it's vocabulary, not data). Feeds the audit UI's Entity type / Action selects, so an app passing `[]` gets empty dropdowns. |
| POST | `/audit/coverage` | `countByDeclared({ entityTypes, actions })` — body is the caller's own declared catalog; an empty body (or none) uses the configured `catalog` instead. Response is a per-declared-entry `{ kind, value, count, assessment }[]`, no catalog table involved. |

All gated on `@RequiresAction('audit.view')`.

## Actor scoping

A **non-platform actor's** reads are forced to their own `tenantId` — a
per-tenant activity feed. A **platform admin** (default: `actor.tenantId === null`,
override via `forRoot({ isPlatformAdmin })`) reads every tenant's records, and
may filter by any `tenantId` or `tenantId=null` (platform-level rows). A
vertical that wants audit reads to be platform-admin-only just doesn't grant
`audit.view` to tenant personas. Every endpoint added above follows the same
rule — including `/audit/events/:id`, where a cross-tenant id 404s exactly
like a missing one, so a non-platform actor can never distinguish "doesn't
exist" from "not yours".

## Wiring

```typescript
import { AuditApiModule } from '.../audit-logging.api';
import { PostgresAuditObservabilityModule } from '.../audit-logging.core.postgres-drizzle';

@Module({
  imports: [
    AuditApiModule.forRoot({
      imports: [PostgresAuditObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
      catalog: [{ entityType: 'invoice', actions: ['invoice.created', 'invoice.void'] }],   // required
      exportMaxRows: 50_000,                                                                 // optional, default 100,000
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required
  ],
})
export class AppModule {}
```

## Depends on

`audit-logging.core` (the reader port + DTOs), and `authorization.core`
(guard, `@RequiresAction`, `CurrentActor`, `Actor`). Never a stack adapter.
The frontend belongs in `ascendra-commons-ui`.
