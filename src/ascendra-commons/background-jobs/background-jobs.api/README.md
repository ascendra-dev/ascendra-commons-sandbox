# `background-jobs.api` — HTTP endpoints for a jobs admin screen

Opt-in NestJS controller over `JOB_OBSERVABILITY_PORT` (reads) and `JobTrigger`
(the one action). Stack-agnostic — wired to a stack adapter at the vertical via
`imports`. **No tenant scoping** — `background-jobs` has no `tenantId` anywhere.

## Endpoints

| Method | Path | Gate | → |
|---|---|---|---|
| GET | `/jobs` | `job.view` | `listJobStatus()` — one row per job (ran, declared a cadence, or registered for triggering): last run, last success, consecutive failures, cadence, `overdue`, `triggerable` |
| GET | `/jobs/alerts` | `job.view` | the dashboard filtered to jobs that are `overdue` and/or have `consecutiveFailures >= 2` — read-only, no ack state, no webhook |
| GET | `/jobs/locks` | `job.view` | the Lock Inspector — `{ supported, locks: [{ lockKey, jobName, holder, acquiredAt, lockedUntil, state: 'held' \| 'expired' }] }`. Lease lock only: put `PostgresLeaseLockInspectorModule` in `imports`; without it `supported: false`. Read-only — no force-release |
| GET | `/jobs/runs` | `job.view` | `getRunHistory({ jobName?, outcome?, trigger?, hasFailedItems?, correlationId?, since?, until?, limit?, cursor?, order? })` — every job's runs, newest first, keyset-paginated, `error` truncated (~500 chars). `{ data, meta: { nextCursor } }` |
| GET | `/jobs/runs/summary?since=` | `job.view` | `runSummary()` — runs, clean / with failed items / job failed, manual, items processed / failed, distinct jobs, counted by `startedAt` |
| GET | `/jobs/runs/volume?tz=` | `job.view` | `volume()` — per-day runs for 30 calendar days in `tz` (IANA, default UTC), oldest run, row count, table size |
| GET | `/jobs/runs/trace/:correlationId` | `job.view` | `getRunHistory({ correlationId, order: 'asc' })` — every run from one request/job chain, oldest first. `{ data, meta }` |
| GET | `/jobs/runs/:id` | `job.view` | `getRun(id)` — one run, full untruncated `error`. 404 if not found (or not a run id) |
| GET | `/jobs/:name/failed-items?minRuns=` | `job.view` | `getFailedItems(name, minRuns?)` — items recurring as a failed ref across at least `minRuns` (default 2) of the job's last 50 runs. Best-effort — see doc comment |
| POST | `/jobs/:name/run` | `job.run` | `JobTrigger.trigger(name, correlationId)` — "run now" / "retry". 200 with `completed` / `job_failed`; **404** for a job not registered for triggering; **409** while it's already running |

Every bad param — a date, `limit` / `minRuns`, an enum (`outcome`, `trigger`, `hasFailedItems`, `order`), a time
zone, a cursor this API didn't issue, a NUL byte — is a 400 naming the param; never a 500. The controller declares
`@UseGuards(AuthorizationEnforcedGuard)`, so it fails closed when the app forgot the global `AuthorizationGuard`.

Gate names are fixed. A vertical whose catalog uses different names grants its
ops role these too.

## The trigger

`POST /jobs/:name/run` is the one mutating endpoint — a manual, privileged job
run. If the vertical binds `auditEmitterToken`, each attempt — refused ones
included — emits a `{ action: 'job.triggered', actorId, jobName, result }` event
(no-op if unbound; no hard dep on `audit-logging`).

The correlation id that ends up on the run (and therefore in `getTrace()`) is
read from an inbound `X-Correlation-Id` header — the same header
`audit-logging`'s `CorrelationIdMiddleware` reads, reused by convention, not by
dependency: this module still has no import from `audit-logging`, but the two
naturally agree when both are wired in the same app. If the caller didn't send
a well-formed one (`[A-Za-z0-9._:-]{1,128}`, the rule every module stores
correlation ids by), the run takes the app's ambient id from
`forRoot({ correlationIdResolver })` — pass audit-logging's
`getCurrentCorrelationId`, and a "Run now" from the admin screen shares one trace
with its own `job.triggered` audit record — else a fresh `crypto.randomUUID()`,
so every manual run is still traceable.

`trigger()` awaits the whole run. For a long job, the vertical's own controller
can fire-and-forget instead; this endpoint always awaits (the advisory lock
still stops a double-click starting a second run).

## Truncated `error` on list rows

`getRunHistory()` and `listJobStatus()` truncate a run's `error` stack to
roughly 500 characters (the recorder stores at most 16,000) — shipping an unbounded stack trace on every row of a
list payload was an unintended info-leak risk, not just a size concern. The
full stack is always available via `GET /jobs/runs/:id`.

## Failed items — best-effort, not exact

`GET /jobs/:name/failed-items` groups `failedItemRefs` across a job's recent
runs to surface "chronic offenders." Matching relies entirely on the job's own
`describeItem()` returning something that identifies the same underlying item
run to run — `describeItem()` is documented as a logging aid, not a stable-id
contract, so a job whose ref embeds something that varies (an index, a
timestamp) will never show a recurrence here even if the same item keeps
failing. Not a dead-letter queue — per-item retry state is a Model 2 concern.

## Alerts — read-only listing only

`GET /jobs/alerts` is a pure filter over the existing `listJobStatus()` output
— no new persistence. Deliberately **not** built in this pass: an
acknowledge/ack-state, and any outbound webhook/notification delivery. Both
are real, separate pieces of work (see `mocks.html`'s Alerts & Overdue
section), not implied by this endpoint.

## What's deliberately not here

`POST /jobs/:name/pause` (Pause / Disable), an alert acknowledge state and an
outbound alert webhook, and a lock force-release — see `mocks.html`'s coverage
map and the module's `AUDIT-REPORT.md`.

## Wiring

```typescript
import { JobsApiModule } from '.../background-jobs.api';
import { PostgresJobObservabilityModule } from '.../background-jobs.core.postgres-drizzle';

@Module({
  imports: [
    BackgroundJobsModule.forRoot({ advisoryLockToken: POSTGRES_LEASE_LOCK, jobs: [InvoiceReminderJob], imports: [ ... ] }),
    JobsApiModule.forRoot({
      auditEmitterToken: MY_AUDIT_EMITTER,       // optional
      imports: [
        PostgresJobObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', cadences: { 'invoice-reminder': '1d' }, imports: [DatabaseModule] }),
      ],
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required
  ],
})
export class AppModule {}
```

`JobTrigger` is exported by `BackgroundJobsModule.forRoot()`; a job is triggerable
only if it's in that call's `jobs: [...]` list.

## Depends on

`background-jobs.core` (the port + `JobTrigger` + DTOs) and `authorization.core`
(guard, `@RequiresAction`, `CurrentActor`, `Actor`). Never a stack adapter.
