# `background-jobs.core.postgres-drizzle` — the Postgres/Drizzle stack adapter

| Sub-folder | Implements | Bound under | Wired via |
|---|---|---|---|
| `lock/postgres-advisory-lock` | `AdvisoryLock` — `pg_try_advisory_lock` (session-level) | `POSTGRES_ADVISORY_LOCK` | `PostgresAdvisoryLockModule.forRoot({ sqlExecutorToken })` — **must be a dedicated single connection** |
| `lock/postgres-lease-lock` | `AdvisoryLock` — a `commons_jobs_lock` row + lease | `POSTGRES_LEASE_LOCK` | `PostgresLeaseLockModule.forRoot({ sqlExecutorToken, application, leaseSeconds? })` — any pooled connection |
| `lock/postgres-lease-lock-inspector` | `JobLockInspectorPort` — lists `commons_jobs_lock` rows, `held` / `expired` | `JOB_LOCK_INSPECTOR_PORT` (core token) | `PostgresLeaseLockInspectorModule.forRoot({ sqlExecutorToken, application })` — in `JobsApiModule`'s `imports`; lease lock only |
| `run-recorder/postgres-job-run-recorder` | `JobRunRecorder` — one `INSERT` per run, each summary normalized first (NULs stripped, refs and error capped) | `POSTGRES_JOB_RUN_RECORDER` | `PostgresJobRunRecorderModule.forRoot({ sqlExecutorToken, application })` — normal pool |
| `observability/postgres-job-observability.service` | `JobObservabilityPort` — `getRunHistory`, `listJobStatus` (overdue detection), `getRun`, `getFailedItems`, `runSummary`, `volume` — each on an index (`0003`) | `JOB_OBSERVABILITY_PORT` (core token) | `PostgresJobObservabilityModule.forRoot({ sqlExecutorToken, application, cadences? })` — normal pool |
| `pruner/job-run-pruner.job` | a reference `ScheduledJob` that trims `commons_jobs_job_run`, in batches of 5,000 | (a normal job) | `JobRunPrunerModule.forRoot({ sqlExecutorToken, application, retentionDays? })` |

`.core` ships **no** lock implementation and no `SqlExecutor` of its own — pick a
lock here explicitly and pass its token to `BackgroundJobsModule.forRoot({ advisoryLockToken })`.

## Pick a lock

| | `PostgresAdvisoryLock` | `PostgresLeaseLock` |
|---|---|---|
| Extra DB objects | none | `commons_jobs_lock` (`migrations/0002_lease_lock.sql`) |
| Connection | **dedicated single connection**, never a transaction-mode pooler | any pooled connection, any pooler |
| Crash frees it | when the connection closes | when the lease (`leaseSeconds`, default 900) expires |
| Knobs | none | `leaseSeconds` |
| "What holds what" | invisible | `SELECT * FROM commons_jobs_lock` |

If you're behind a transaction pooler (PgBouncer / Supabase "Transaction
pooler") or want forgiving wiring, use `PostgresLeaseLock`.

## Wiring (lease lock)

Tables: apply `migrations/` (`0001_job_run`, `0003_job_run_read_indexes`; `0002_lease_lock` is unused with the advisory lock, and harmless) (`ascendra-commons.js` delivers them into your migrations) with your own migration tool — never re-export the schema tables to `drizzle-kit` too, or it generates them a second time (MODULE-STANDARD dimension 7).

```typescript
BackgroundJobsModule.forRoot({
  advisoryLockToken: POSTGRES_LEASE_LOCK,
  jobRunRecorderToken: POSTGRES_JOB_RUN_RECORDER,
  jobs: [InvoiceReminderJob],
  imports: [
    PostgresLeaseLockModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
    PostgresJobRunRecorderModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
    InvoiceModule,
  ],
}),
// optional — for the admin screen (background-jobs.api serves it):
PostgresJobObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', cadences: { 'invoice-reminder': '1d' }, imports: [DatabaseModule] }),
// optional — keep the history table bounded (give JobRunPrunerJob a @Cron wiring class):
JobRunPrunerModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', retentionDays: 90 }),
```

For the session-level lock, swap `PostgresLeaseLockModule` →
`PostgresAdvisoryLockModule.forRoot({ sqlExecutorToken: SCHEDULER_DB })` where
`SCHEDULER_DB` is a `drizzle(new Pool({ max: 1, idleTimeoutMillis: 0 }))`.

**Requires PostgreSQL** and the `commons_jobs_job_run` migration (+
`commons_jobs_lock` if using the lease lock).

## `application` scoping

Every `commons_jobs_job_run` / `commons_jobs_lock` row carries `application` and
every read/write/DELETE filters on it — in a shared operational database an app
never sees or prunes another's history.

## Depends on

`background-jobs.core`, `@nestjs/common`, `drizzle-orm` (`drizzle-orm/pg-core`).
