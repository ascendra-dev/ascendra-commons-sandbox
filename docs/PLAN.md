# ascendra-commons-sandbox — plan

A NestJS host app that runs `ascendra-commons` modules for real, so `ascendra-commons-ui` can be built and
reviewed against real APIs and real data instead of mocks. Audit logging first; every later module follows the
same recipe.

Status: **phase 1 (skeleton) built 2026-10-17, awaiting review.** Execution is phase by phase — each phase ends at a checkpoint
(shown working, reviewed, then committed) before the next one starts.

## Why

`ascendra-commons` is a library of copy-in NestJS packages; nothing runs them outside tests. The UI has only ever
seen mocks, and the mocks already hide real mismatches:

- Real audit `action` values are verb-only (`status_changed`); the mocks use `invoice.created`. The UI's dot
  colours split on the `.`, so real data would come out all gray.
- `GET /audit/stats` returns no `kpis` and no per-action `actors` — the Overview tiles would be empty and Top
  Actions would crash.
- `GET /audit/retention` doesn't exist; the backend keeps audit records indefinitely.
- (Already removed: the entity "neighbors" endpoint the UI called never existed.)

## Projects

| Project | Role |
|---|---|
| `ascendra-commons` | Backend modules — source of truth. |
| `ascendra-ui` | Component library. |
| `ascendra-commons-ui` | UI packages + testbed (Next.js, :3002). |
| **`ascendra-commons-sandbox`** (this repo) | NestJS host (:3010) + sample domain + data generator + Postgres. |

## Decisions

| # | Decision |
|---|---|
| 1 | Separate repo, `ascendra-public/ascendra-commons-sandbox`. |
| 2 | Dev auth: a dev-signed token `{ id, persona, tenantId }` → `request.actor`; a static-map authorizer grants `audit.view`. A persona switcher in the testbed picks the token. No Supabase. |
| 3 | Mocks are deleted from both `packages/audit-logging.ui` and the testbed copy — **last**, once the real API can replace every screen (Overview stats and Retention still depend on them). |
| 4 | The generator runs in-process: a CLI on the same Nest container, calling the domain services directly. |
| 5 | `commons:update` re-vendors from GitHub by default, or from a local checkout with `--from ../ascendra-commons`. |
| 6 | API on :3010. Postgres: the sandbox's own `postgres:16` container on :5433 (independent of any other project's database). |

## Layout

```
ascendra-commons-sandbox/
  commons.manifest.json        which ascendra-commons packages are vendored
  scripts/commons-update.js    re-vendors the manifest's packages (GitHub or --from <path>)
  docker-compose.yml           Postgres 16
  src/
    ascendra-commons/<pattern>/<package>/   vendored, never hand-edited
    auth/                      dev token guard, personas, static-map wiring
    domain/                    thin sample product: invoices, payments, users, channel routes, attachments
    audit/                     AuditLoggingModule + AuditApiModule wiring, the audit catalog
    db/                        connection, migration runner
    cli/                       seed / simulate entry points (Nest standalone context)
  docs/PLAN.md                 this page
```

Vendored for audit: `audit-logging.core`, `audit-logging.core.postgres-drizzle`, `audit-logging.api`,
`domain-events.core`, `domain-events.core.in-process`, `authorization.core`, `authorization.core.static-map`.
NestJS version follows `ascendra-commons` (`@nestjs` ^10).

## Data generation

- Through real code paths: the generator calls domain services, which raise `AuditRecordRaised` with
  `emitCritical` inside their transaction — the shipped listener, repository and correlation id all run. The one
  exception is a bulk volume mode that batch-writes for export / performance testing (100k+ rows).
- Scenarios: invoice lifecycles (created → issued → paid; failed → retried; voided), role grants and revokes,
  uploads, route changes, platform-level events (no tenant), nested before/after diffs, long reasons, an entity
  with more than 50 events ("Load older"), multi-entity traces under one correlation id. 3 tenants, ~8 actors.
- Backdated over 90 days (`AuditRecordRaised` takes `occurredAt`). Deterministic with `--seed`.
- Live mode keeps emitting events every few seconds.

## Commands

| Where | Command | Does |
|---|---|---|
| sandbox | `npm run db:up` / `db:down` | Start / stop Postgres. |
| sandbox | `npm run db:migrate` | Apply each vendored package's `*.migration.sql`, then the domain tables. |
| sandbox | `npm run db:reset` | Drop, migrate, seed — a clean slate in one step. |
| sandbox | `npm run seed -- --days 90 --seed 42 [--volume large]` | Generate history. |
| sandbox | `npm run simulate -- --live --every 5s` | Continuous events. |
| sandbox | `npm run start:dev` | API on :3010. |
| sandbox | `npm run commons:update -- --yes [--from ../ascendra-commons]` | Re-vendor the manifest's packages. |
| commons-ui | `npm run ascendra-ui:update -- --yes` | Re-vendor ascendra-ui (unchanged). |
| testbed | `.env.local`: `NEXT_PUBLIC_API_URL=http://localhost:3010` | Point the testbed at the sandbox. |

## Keeping things in sync

1. A backend change is committed in `ascendra-commons` → `commons:update` here → `db:reset` if a schema changed.
2. A UI change follows the existing ascendra-ui → ascendra-commons-ui flow.
3. The API contract: `audit-api.types.ts` in the UI stays a hand-written mirror of the backend DTOs; real data
   shows drift immediately. Later: a `contract:check` here that calls every endpoint and validates the shapes.
4. With the testbed on the real API, `packages/observability` becomes a straight copy of the testbed (no more
   mock-vs-real fetcher lines).

## Phases

Each phase ends at a checkpoint: shown working → reviewed → committed.

1. **Skeleton** — Nest app, Postgres, manifest + `commons:update`, `db:migrate` / `db:reset`, health endpoint.
   *Checkpoint:* the vendored audit migration applied; the app boots.
2. **Audit wiring** — dev auth + personas, `audit.view`, domain-events + audit-logging + Postgres adapter +
   `AuditApiModule` with the catalog, CORS for the testbed.
   *Checkpoint:* `/audit/events` answers with an empty list for a platform admin, 403 without `audit.view`.
3. **Sample domain + generator** — domain services raising audit events, seed scenarios, live mode.
   *Checkpoint:* `db:reset` produces a realistic 90-day history; a few raw API calls reviewed.
4. **Testbed on the real API** — env, dev persona switcher, list + sheets on `auditApi`, mirror copied verbatim.
   *Checkpoint:* the Audit Log and all four sheets reviewed on real data.
5. **Fix what real data exposes** — verb-only dot colours (UI), stats `kpis` / `actors` (backend or UI reshape),
   tenant-aware columns, Retention & volume (needs a backend decision first).
   *Checkpoint:* each fix reviewed on its own.
6. **Delete the mocks** (both copies) once nothing uses them; module README updated.
7. **Docs** — this repo's README, and a "new module onboarding" checklist: manifest entry, domain scenario,
   seed scenario, catalog, testbed wiring.

## Later modules

Same recipe per module — one manifest entry, one domain scenario, one seed scenario: `background-jobs` runs real
jobs, `rate-limiting` gets a throttled endpoint the generator hits, `notification` sends through a fake channel.
