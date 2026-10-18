# ascendra-commons-sandbox

A NestJS host app that runs `ascendra-commons` modules for real — vendored exactly as a product would vendor them —
so `ascendra-commons-ui` is built and reviewed against real APIs and real data instead of mocks.

The plan, decisions and phase status: [docs/PLAN.md](docs/PLAN.md).

## Quickstart

Needs Node 20.6+ (for `--env-file`) and Docker.

```sh
cp .env.example .env
npm install
npm run db:up        # Postgres 16 in docker, on :5433
npm run db:reset     # migrate + seed 90 days of realistic audit history
npm run start:dev    # http://localhost:3010 — GET /health
```

## Signing in (dev)

There's no real identity provider: pick a dev user and get a token for it. A platform admin reads every tenant's
audit records, a tenant admin only its own tenant's, and the member has no `audit.view` (the audit API answers 403).

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
| `GET /audit/*` | `audit.view` | audit-logging's read API (`audit-logging.api`). |

Errors follow api-contract Rule 1 (`{ statusCode, error, message, code, path }`); every response carries an
`X-Request-Id` (Rule 7). CORS allows the origins in `CORS_ORIGINS`.

## Commands

| Command | Does |
|---|---|
| `npm run db:up` / `db:down` | Start / stop the sandbox's Postgres container. |
| `npm run db:migrate` | Apply migrations not yet applied: each vendored package's `*.migration.sql` (manifest order), then `src/db/migrations/*.sql`. |
| `npm run db:reset [-- --no-seed] [-- --days 90 --seed 42 --volume small\|normal\|large]` | Drop everything, migrate from scratch, seed (seed options pass through). |
| `npm run seed -- [--days 90] [--seed 42] [--volume normal]` | Generate history into an empty database. Same `--seed`, same data. |
| `npm run simulate -- [--every 5] [--count 0]` | Keep it live: one real change every N seconds until Ctrl+C (or `--count`). |
| `npm run commons:update -- --yes [--from ../ascendra-commons]` | Re-vendor the packages in `commons.manifest.json` into `src/ascendra-commons/` — from GitHub, or a local checkout. Records the source commit in `src/ascendra-commons/VENDORED.json`. |
| `npm run start:dev` / `build` / `start` | Run in watch mode / build / run the build. |
| `npm run typecheck` | Typecheck, vendored code included. |

`src/ascendra-commons/` is vendored — never edit it here. Change the module in `ascendra-commons`, then re-sync.
If a sync changes a migration that was already applied, `db:migrate` refuses and asks for `db:reset`.

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

`normal` volume is about 3,900 records over 90 days; `large` is about 25× that, for export and performance testing.
