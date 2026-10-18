# ascendra-commons-sandbox — plan

A NestJS host app that runs `ascendra-commons` modules for real, so `ascendra-commons-ui` can be built and
reviewed against real APIs and real data instead of mocks. Audit logging first; every later module follows the
same recipe.

Status: **phases 1–5 done (3b, 3c included), 2026-10-18; phase 6 (delete the mocks) is next.** Execution is phase by phase — each phase ends at a checkpoint
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
| 4 | The generator runs in-process: a CLI on the same Nest container that emits audit events directly — no sample product. |
| 5 | ascendra-commons is vendored exactly as a product vendors it — with ascendra-commons' own `ascendra-commons.js` (`add` / `update` / `status`, `--from ../ascendra-commons` for unpushed work). Decided 2026-10-18, replacing a sandbox-only manifest + update script + migration runner that no real consumer would have. |
| 6 | API on :3010. Postgres: the sandbox's own `postgres:16` container on :5433 (independent of any other project's database). |

## Layout

```
ascendra-commons-sandbox/
  ascendra-commons.js          ascendra-commons' own script (copied in by init, kept current by update)
  ascendra-commons.json        the packages asked for + where migrations go (drizzle-kit)
  drizzle.config.ts            drizzle-kit — the migration tool, as in any Ascendra app
  scripts/db-reset.js          sandbox-only: drop, drizzle-kit migrate, seed
  docker-compose.yml           Postgres 16
  src/
    ascendra-commons/<pattern>/<package>/   vendored by the script, never hand-edited (VENDORED.json: commit + checksums)
    modules/commons/           every commons module configured in one place — one file per module + CommonsModule
    auth/                      sandbox-only dev sign-in (dev tokens, personas) + the global guard order
    db/                        DatabaseModule (DATABASE_CONNECTION), schema/ (own tables — none), migrations/ (drizzle-kit)
    common/                    api-contract plumbing: error filter, request id
    cli/                       sandbox-only: audit-history.ts (the event script) + seed / simulate
  docs/PLAN.md                 this page
```

Vendored for audit: `audit-logging.core`, `audit-logging.core.postgres-drizzle`, `audit-logging.api`,
`domain-events.core`, `domain-events.core.in-process`, `authorization.core`, `authorization.core.static-map`.
NestJS version follows `ascendra-commons` (`@nestjs` ^10).

## Data generation

- Through ascendra-commons itself: one sequential script (`src/cli/audit-history.ts`) emits `AuditRecordRaised` with
  `emitCritical`, and the shipped listener, repository and correlation id do the rest. No product, no domain tables
  (decided 2026-10-18 — a first version with domain services and tables was dropped as unnecessary); each event
  carries only what that change touched.
- Scenarios: invoice lifecycles (created → issued → paid; failed → retried; voided), role grants and revokes,
  uploads, route changes, platform-level events (no tenant), nested before/after diffs, long reasons, an entity
  with more than 50 events ("Load older"), multi-entity traces under one correlation id. 3 tenants, ~8 actors.
- Backdated over 90 days (`AuditRecordRaised` takes `occurredAt`). Deterministic with `--seed`.
- Live mode keeps emitting events every few seconds.

## Commands

| Where | Command | Does |
|---|---|---|
| sandbox | `npm run db:up` / `db:down` | Start / stop Postgres. |
| sandbox | `npm run db:migrate` | `drizzle-kit migrate` — commons' delivered migrations included. |
| sandbox | `npm run db:reset` | Drop, migrate, seed — a clean slate in one step. |
| sandbox | `npm run seed -- --days 90 --seed 42 [--volume large]` | Generate history. |
| sandbox | `npm run simulate -- --live --every 5s` | Continuous events. |
| sandbox | `npm run start:dev` | API on :3010. |
| sandbox | `node ascendra-commons.js update [--from ../ascendra-commons]` | Newer commons — refuses local edits, shows breaking changes first, delivers new migrations. |
| commons-ui | `npm run ascendra-ui:update -- --yes` | Re-vendor ascendra-ui (unchanged). |
| testbed | `.env.local`: `NEXT_PUBLIC_API_URL=http://localhost:3010` | Point the testbed at the sandbox. |

## Keeping things in sync

1. A backend change is committed in `ascendra-commons` → `node ascendra-commons.js update` here → `db:migrate` for any
   new migration it delivered.
2. A UI change follows the existing ascendra-ui → ascendra-commons-ui flow.
3. The API contract: `audit-api.types.ts` in the UI stays a hand-written mirror of the backend DTOs; real data
   shows drift immediately. Later: a `contract:check` here that calls every endpoint and validates the shapes.
4. With the testbed on the real API, `packages/observability` becomes a straight copy of the testbed (no more
   mock-vs-real fetcher lines).

## Phases

Each phase ends at a checkpoint: shown working → reviewed → committed.

1. **Skeleton** — Nest app, Postgres, vendored packages, `db:migrate` / `db:reset`, health endpoint.
   *Checkpoint:* the vendored audit migration applied; the app boots.
2. **Audit wiring** — dev auth + personas, `audit.view`, domain-events + audit-logging + Postgres adapter +
   `AuditApiModule` with the catalog, CORS for the testbed.
   *Checkpoint:* `/audit/events` answers with an empty list for a platform admin, 403 without `audit.view`.
3. **Generator** — the audit event script, seed, live mode.
   *Checkpoint:* `db:reset` produces a realistic 90-day history; a few raw API calls reviewed.
   **3b. Consumer tooling (done 2026-10-18)** — built in ascendra-commons: numbered never-edited migrations,
   `ascendra-commons.js`, `scripts/check.js` + pre-push hook. The sandbox switched to it — no sandbox-only vendoring left.
   **3c. Integrate like any consumer (done 2026-10-18)** — drizzle-kit as the migration tool (commons' migrations in
   its journal via `generate --custom`); all commons configuration in `src/modules/commons/` (`CommonsModule`), dev
   sign-in alone in `src/auth/`; ascendra-commons' README gained "Integrating into a project", which this follows.
4. **Testbed on the real API** — env, dev persona switcher, list + sheets on `auditApi`, mirror copied verbatim.
   *Checkpoint:* the Audit Log and all four sheets reviewed on real data.
5. **Fix what real data exposes** — verb-only dot colours (UI), stats `kpis` / `actors` (backend or UI reshape),
   stats ranking top actions by verb alone (`created` merges invoices, users and tenants), tenant-aware columns,
   Retention & volume (needs a backend decision first), and audit-logging's README not saying the host's SQL executor
   must join the caller's transaction (found in phase 3: its Postgres repository writes through whatever executor it's
   given, so with a plain pool an audit record survives a change that rolled back).
   Found in phase 4, on real data: the trace and history sheets' timeline dots are all gray (verb-only actions);
   actor activity's "By action" table drops the entity type (`failed` for a payment beside `payment_failed` for an
   invoice — and `created` would merge invoices, users and tenants), the stats ranking's problem again; a 401 / 403 is
   retried several times (~10 s) before the error shows, where it should fail at once — and a direct visit without
   access deserves a clearer message than a bare "Forbidden"; the testbed avatar's initials come from the persona
   label ("Acme — member (no audit access)" → "AA").
   *Checkpoint:* each fix reviewed on its own.
   **Done 2026-10-18**, each reviewed and committed: dot colours by verb words; Overview stats as two endpoints
   (KPIs, top actions by entity type + action — also actor activity); 4xx not retried + the guard's 403 names the
   action; a tenant admin sees no Tenant column/filter; `GET /audit/retention` (read-only) and the real Retention
   screen; the transaction note in audit-logging's README; dev users' display names.
6. **Delete the mocks** (both copies) once nothing uses them; module README updated.
7. **Docs** — this repo's README, and a "new module onboarding" checklist: `node ascendra-commons.js add`, domain scenario,
   seed scenario, catalog, testbed wiring.

## Later modules

Same recipe per module — one `node ascendra-commons.js add` and one generator script that drives the module through its own entry
points, never a product built around it: `background-jobs` enqueues and runs real jobs, `rate-limiting` gets a
throttled endpoint the generator hits, `notification` sends through a fake channel.
