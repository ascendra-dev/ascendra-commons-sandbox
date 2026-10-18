# ascendra-commons-sandbox

A NestJS host app that runs `ascendra-commons` modules for real — vendored and wired exactly as a product would — so
`ascendra-commons-ui` is built and reviewed against real APIs and real data. (`ascendra-commons-ui` has no mocks: its
testbed runs on this.)

| Repo | Role |
|---|---|
| `ascendra-commons` | The backend modules — the source of truth. |
| **`ascendra-commons-sandbox`** (this repo) | Runs them: NestJS on :3010, its own Postgres, generated history, dev sign-in. |
| `ascendra-commons-ui` | The modules' admin UI; its `testbed/` (Next.js, :3002) talks to this API. |
| `ascendra-ui` | The component library the UI is built with. |

- The plan, decisions and phase status: [docs/PLAN.md](docs/PLAN.md).
- Adding the next module (background-jobs, rate-limiting, …): [docs/NEW-MODULE.md](docs/NEW-MODULE.md).

## Quickstart

Needs Node 20.6+ (for `--env-file`) and Docker.

```sh
cp .env.example .env
npm install
npm run db:up        # Postgres 16 in docker, on :5433
npm run db:reset     # migrate + seed 90 days of realistic audit history
npm run start:dev    # http://localhost:3010 — GET /health
```

Then the UI, in `ascendra-commons-ui/testbed`:

```sh
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:3010, next-auth settings
npm install
npm run dev -- -p 3002        # http://localhost:3002/observability — sign in from the avatar menu
```

## Signing in (dev)

There's no real identity provider: pick a dev user and get a token for it (the testbed's avatar menu does this for
you). Tokens last 12 hours.

| Dev user | Persona | Tenant | Sees |
|---|---|---|---|
| `platform.admin@ascendra.test` — Platform Admin | `platform-admin` | — | every tenant's records |
| `admin@acme.test` / `admin@globex.test` / `admin@meridian.test` | `tenant-admin` | their own | their tenant's records only |
| `member@acme.test` — Acme Member | `member` | `tenant_acme` | nothing: no `audit.view`, the audit API answers 403 |

What each persona may do is authorization's config — `PERSONA_ACTIONS` in `src/modules/commons/authorization.ts`.

```sh
curl localhost:3010/dev/personas                       # who you can be
curl -X POST localhost:3010/dev/token -H 'Content-Type: application/json' \
  -d '{"actorId":"platform.admin@ascendra.test"}'       # → { token, expiresAt, actor }
curl localhost:3010/audit/events -H "Authorization: Bearer <token>"
```

| Endpoint | Auth | Does |
|---|---|---|
| `GET /health` | public | App up, database reachable (503 if not). |
| `GET /dev/personas`, `POST /dev/token` | public, not in production | Dev sign-in. |
| `GET /me` | token | `{ actor, allowedActions }` — for showing or hiding nav. |
| `GET /audit/events`, `/events.csv`, `/events/:id` | `audit.view` | The audit log, its CSV export, one record with its diff. |
| `GET /audit/entities/:type/:id/history`, `/trace/:correlationId`, `/actors/:actor/activity` | `audit.view` | One entity's history, one request's trace, one actor's activity. |
| `GET /audit/stats/overview`, `/stats/top-actions`, `/retention`, `/catalog` | `audit.view` | The Overview, Retention & Volume, and the filter vocabulary. |

The audit endpoints are `audit-logging.api`'s — its README has the details. A tenant admin's results are always
scoped to their own tenant; a platform admin may pass `tenantId`.

Errors follow api-contract Rule 1 (`{ statusCode, error, message, code, path }`); every response carries an
`X-Request-Id` (Rule 7). CORS allows the origins in `CORS_ORIGINS`.

## Commands

| Command | Does |
|---|---|
| `npm run db:up` / `db:down` | Start / stop the sandbox's Postgres container. |
| `npm run db:migrate` | `drizzle-kit migrate` — applies `src/db/migrations/` (ascendra-commons' delivered migrations included). |
| `npm run db:reset [-- --no-seed] [-- --days 90 --seed 42 --volume small\|normal\|large]` | Drop everything, migrate from scratch, seed (seed options pass through). |
| `npm run seed -- [--days 90] [--seed 42] [--volume normal]` | Generate history into an empty database. Same `--seed`, same data. |
| `npm run simulate -- [--every 5] [--count 0]` | Keep it live: one real change every N seconds until Ctrl+C (or `--count`). |
| `npm run start:dev` / `build` / `start` | Run in watch mode / build / run the build. |
| `npm run typecheck` | Typecheck, vendored code included. |

## ascendra-commons, as any project consumes it

The sandbox integrates ascendra-commons exactly as its README's "Integrating into a project" says a product does.
Nothing here is sandbox-specific:

| File | |
|---|---|
| `ascendra-commons.js` | The script, copied in by `init`; `update` keeps it current. |
| `ascendra-commons.json` | The packages asked for, and where migrations go (`drizzle-kit` → `src/db/migrations`). |
| `src/ascendra-commons/` | The vendored packages — never edit them here. `VENDORED.json` records the commit and a checksum per file. |
| `src/modules/commons/` | Every commons module configured in one place: `domain-events.ts`, `authorization.ts` (persona → actions), `audit-logging.ts` (+ `audit-catalog.ts`), and `CommonsModule`, which `AppModule` imports. |
| `drizzle.config.ts`, `src/db/` | drizzle-kit as the migration tool; `DatabaseModule` provides `DATABASE_CONNECTION`, the executor the Postgres adapters write through. |

```sh
node ascendra-commons.js status                          # edited copies, missing deps, undelivered migrations
node ascendra-commons.js update [--from ../ascendra-commons]   # GitHub, or a local checkout for unpushed work
node ascendra-commons.js add <package…>                  # e.g. background-jobs.core.postgres-drizzle
```

A new migration from an update lands in `src/db/migrations/`, registered in drizzle-kit's journal — `db:migrate`
applies it. Adding a module: `add` it, then one new file in `src/modules/commons/` imported by `CommonsModule`. Change a
module in `ascendra-commons`, never here: `update` refuses to overwrite a local edit.

What *is* sandbox-only: `src/cli/` (the data generator), `src/auth/` dev sign-in (dev tokens and personas, standing in
for a real identity provider), `docker-compose.yml`, and `scripts/db-reset.js`.

## The sample data

`src/cli/audit-history.ts` is one sequential script of `emit(...)` calls. Each raises an `AuditRecordRaised` through
ascendra-commons — its AuditListener and Postgres repository do the insert — at a past moment, under a correlation id.
There's no product behind it: each event carries just what that change touched.

- 3 tenants (`tenant_acme`, `tenant_globex`, `tenant_meridian`) with their admins and staff, plus the platform admin
  and the payment gateway (`system:payment-gateway`).
- Invoices through realistic lifecycles over days and weeks: created, revised (a billing-street change shows as a
  nested diff, new line items as a list diff), issued (sometimes with an attachment in the same request), paid by the
  gateway, failed and retried, voided with a reason, refunded. Fewer on weekends.
- A payment and its invoice change in one request, so they share a correlation id (a two-entity trace).
- One draft invoice revised 60 times, so its history needs "Load older".
- Platform-level records (no tenant): tenants created and upgraded.

`normal` volume is about 3,700–3,900 records over 90 days (history ends at the real "now", so the exact count moves
with the hour); `large` is about 25× that, for export and performance testing. The same `--seed` at the same moment
gives the same records.
