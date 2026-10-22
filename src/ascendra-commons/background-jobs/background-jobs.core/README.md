# `background-jobs.core` — the contract + the safety mechanism

Something needs to run on a schedule, safely, exactly once per due item — no
duplicate execution across a rolling deploy's window, no lost fire, no single
item's failure stalling the batch. `ScheduledJob<TItem>` and
`IdempotentJobRunner` carry no knowledge of any particular use case.

Like `audit-logging` there is **no Model 1 / Model 2 config split** — "Model 2"
is a real job queue (pg-boss etc.) behind the same `ScheduledJob` interface,
only `IdempotentJobRunner`'s internals swap.

## What's in here

| Piece | Purpose |
|---|---|
| `ScheduledJob<TItem>` | `name` (unique — becomes the lock key), `findDueItems()`, `processItem()`, optional `describeItem()`. |
| `AdvisoryLock` (port) | `tryAcquire(key)` / `release(key)` — a cross-instance mutex. **No implementation here** — wire `POSTGRES_ADVISORY_LOCK` or `POSTGRES_LEASE_LOCK` from the stack adapter. |
| `IdempotentJobRunner` | Acquire the lock → `findDueItems()` → `processItem()` per item with per-item failure isolation → release → record. A lock-not-acquired return is *not* a run. |
| `JobRunRecorder` (port) + `NoopJobRunRecorder` | Best-effort run telemetry — **must not throw** (opposite posture to `audit-logging`). No-op by default. |
| `JobRunSummary` | One per lock-acquiring run — `outcome`, `itemsDue/Processed/Failed`, `failedItemRefs` (capped 50), `error?`, `correlationId?`. |
| `ScheduledJobRegistry` + `JobTrigger` | Resolve a job by *name* (what a UI sends) → run it out of schedule. `start()` answers once the lock is taken (`JobStartResult`: `unknown_job` / `already_running` / `started`) and lets the run go on — what an HTTP endpoint uses; `trigger()` awaits the run (`JobTriggerResult`: … / `completed` / `job_failed`) — for a script or a test. |
| `JobObservabilityPort` + DTOs (`JobRunRecord`, `JobStatus`, `RunHistoryQuery/Page`) | The run-history + dashboard reads — a stack adapter implements it, `background-jobs.api` serves it. |
| `parseCadence` / `humanizeDuration`, `encodeKeysetCursor` | Stack-agnostic helpers the observability adapter reuses. |
| `BackgroundJobsModule.forRoot({ advisoryLockToken, jobRunRecorderToken?, jobs?, imports })` | Binds the tokens + provides the runner / trigger / registry. Schedules nothing. |

## `applicationId` / `tenantId`

Neither appears in `.core` — a run never leaves the process it happens in.
The Postgres adapter's `commons_jobs_job_run` table carries an `application`
column (dimension 4). Per-item tenancy lives entirely inside a job's own
`findDueItems()` / `processItem()`.

## Wiring

```typescript
// with the pool-safe lease lock (no dedicated connection needed):
BackgroundJobsModule.forRoot({
  advisoryLockToken: POSTGRES_LEASE_LOCK,
  jobRunRecorderToken: POSTGRES_JOB_RUN_RECORDER,   // optional
  jobs: [InvoiceReminderJob],                        // optional — triggerable by name
  imports: [
    PostgresLeaseLockModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
    PostgresJobRunRecorderModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
    InvoiceModule,
  ],
})
```

Each job supplies its own `@Cron` / `OnApplicationBootstrap` wiring class around
`IdempotentJobRunner` — this module ships no scheduler. You also need
`@nestjs/schedule` + `ScheduleModule.forRoot()`.

## Consuming this module

`node ascendra-commons.js add` one stack adapter (`background-jobs.core.postgres-drizzle`,
which brings this package), and optionally `background-jobs.api`.

## Depends on

`@nestjs/common`. No database driver, no ORM.
