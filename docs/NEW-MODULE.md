# Adding a module to the sandbox

The checklist for bringing the next `ascendra-commons` module (background-jobs, rate-limiting, notification, …) into
the sandbox and the `ascendra-commons-ui` testbed — the path `audit-logging` took, in order. Steps 1–3 are exactly what
any product does (`ascendra-commons`' README, "Integrating into a project"); the sandbox only adds data (step 5) and a
way to sign in as different people.

Each numbered step ends at a checkpoint — shown working, reviewed, committed — before the next starts. A module is
done when it also has its `GUIDE.md` and `AUDIT-REPORT.md` (step 9) — `ascendra-commons`'
[`MODULE-GUIDE-TEMPLATE.md`](https://github.com/ascendra-dev/ascendra-commons/blob/main/MODULE-GUIDE-TEMPLATE.md) says
what they cover; `audit-logging/` is the worked example.

## 1. Vendor it

- [ ] Read the module's README, "Consuming this module": which stack adapter, whether its `.api` package is wanted,
      and which *choices* you must name yourself (a transport, an authorizer — nothing imports them, so `add` can't
      see them).
- [ ] `node ascendra-commons.js add <package…>` — it adds every package their code imports, and delivers the module's
      migrations into `src/db/migrations/` (drizzle-kit's journal).
- [ ] Install the npm packages `add` lists as missing (it never runs `npm install`).
- [ ] `node ascendra-commons.js status` — no problems.

*Not working on the module's code here:* if it needs a fix, make it in `ascendra-commons` and
`node ascendra-commons.js update --from ../ascendra-commons` (unpushed) or `update` (pushed) — never edit
`src/ascendra-commons/`.

## 2. Migrate

- [ ] `npm run db:migrate` — or `npm run db:reset` for a clean slate.
- [ ] The module's tables exist (`commons_<module>_…`).

## 3. Configure it — `src/modules/commons/`

- [ ] One file, `src/modules/commons/<module>.ts`, exporting its `forRoot(...)` modules — the shape is in the module's
      README. The Postgres adapters take `sqlExecutorToken: DATABASE_CONNECTION` (with `imports: [DatabaseModule]`) and
      `application` (`process.env.APPLICATION`, as `audit-logging.ts` does).
- [ ] Import it in `CommonsModule` (`commons.module.ts`); export it too if another module, a controller or the CLI
      needs its tokens (as `domainEvents` is exported for the generator).
- [ ] What the host provides (README, "Integrating into a project") is already in place: `DATABASE_CONNECTION`,
      `request.actor` before the deny-by-default `AuthorizationGuard`, `CorrelationIdMiddleware`, the api-contract
      error filter and request id. A module needing something new from the host (a cron scheduler, a storage bucket,
      a mail channel) gets it here — a fake where the real thing is external (`notification` sends through a fake
      channel).
- [ ] `npm run typecheck`; `npm run start:dev` boots.

## 4. Grant its actions

- [ ] The module's `.api` actions (its `*_ACTIONS` export) go into `PERSONA_ACTIONS` in `authorization.ts` — which
      persona may do what — and into `ALL_ACTIONS`, so `GET /me` reports them and the UI's nav follows.
- [ ] If a screen should be hidden from someone, make sure a dev user lacks it (`src/auth/dev-actors.ts`), so the
      denied path is testable — like the member without `audit.view`.

## 5. Generate its data — `src/cli/`

- [ ] One sequential script, `src/cli/<module>-history.ts`, that drives the module through **its own entry points** —
      never a product built around it: background-jobs enqueues and runs real jobs, rate-limiting gets a throttled
      endpoint the generator hits, notification sends through the fake channel. `audit-history.ts` is the model: each
      call commented, carrying only what that change touched.
- [ ] Deterministic: use `Rng` (`rng.ts`) and `cast.ts`'s people, so the same `--seed` gives the same data.
- [ ] Spread over `--days` where the module lets you set a past time; where it can't, say so in the script — the UI
      then shows only recent activity.
- [ ] Call it from `seed.ts` (and `simulate.ts`, if live activity makes sense). Cover the screens' edge cases on
      purpose — an empty state, a failure, pagination past one page, the tenant split, a platform-level row.
- [ ] `npm run db:reset` — realistic history in seconds.

## 6. Check the API raw

- [ ] As each dev user (`POST /dev/token`, `curl`): the platform admin sees every tenant, a tenant admin only their
      own, a user without the action gets a 403 naming it.
- [ ] Shapes match what the module's README says; anything new a browser must read from a response header is added to
      `EXPOSED_HEADERS` in `src/main.ts`.

## 7. The UI — `ascendra-commons-ui`

- [ ] `packages/<module>.ui/` — `nav.ts` (its one entry, with its `requiredAction`), `links.ts`, `api/` (a typed client
      over the module's DTOs, by hand), `queries/` if a screen uses the full DataTable query system. No `mocks/`: build
      against this sandbox.
- [ ] Copy it to `testbed/ascendra-commons-ui/<module>.ui/` (hand-copied, identical).
- [ ] Screens in `testbed/app/observability/<module>/`, following `ascendra-framework`'s
      `reference/ascendra-ui/hard-instructions.md` (page recipes, loading states inside the shell, `formatDateTime`, …).
- [ ] Its nav entry in `moduleNavEntries` (`testbed/app/observability/layout.tsx`); screens that adapt to who's looking
      read `useSession()`.
- [ ] Re-derive the shipped copy: `rsync -a --delete testbed/app/observability/ packages/observability/`.
- [ ] Typecheck both: the repo root and `testbed/`; `npx eslint` in `testbed/` is clean.

## 8. Review on real data

- [ ] Walk every screen as every dev user in the testbed (a scripted Playwright run catches more than eyes): nav
      appears and disappears with the action, tenant scoping holds, the 403 reads clearly, sheets and pagination work.
- [ ] Write down what real data exposes — it always exposes something (for audit-logging: verb-only actions coloring
      every dot gray, stats ranking by verb alone, no KPIs) — and fix each on its own, backend fixes in
      `ascendra-commons` (then `update` here).

## 9. Review it, and write its guide

The module's own review, run the way `MODULE-GUIDE-TEMPLATE.md` ("How a module review runs") lays it out.

- [ ] Its drill-downs: every number on a screen that can link to the list does, carrying exactly the window it
      counted — click it and compare with the list's total.
- [ ] A backend code review against the template's **backend conventions** checklist. Reproduce each suspected bug
      here first (`curl` as a dev user: a bad date, a bad number, a garbage cursor, a malformed id — none may be a
      500), fix it in `ascendra-commons` with a test, `update`, and probe again.
- [ ] `EXPLAIN` each read the screens make (`SET enable_seqscan = off` first — the sample data is small enough that
      Postgres prefers scanning); a missing index is the next numbered migration.
- [ ] Write `<module>/GUIDE.md` and `<module>/AUDIT-REPORT.md` in `ascendra-commons`, beside its README, with the
      template's required sections — the guide's code excerpts real, the report's gaps prioritised P1 / P2 / P3.

## 10. Record it

- [ ] `docs/PLAN.md` — the module under "Later modules", with its status.
- [ ] `README.md` — its endpoints in the table, its data under "The sample data".
