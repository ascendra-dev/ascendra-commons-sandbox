/**
 * Injection tokens. Symbols, not string literals, same reasoning as every
 * other module in this library — a typo in a binding is a compile error, not
 * a silently unbound provider.
 */

/** What `IdempotentJobRunner` depends on — bound to whichever `AdvisoryLock` implementation the app wires. */
export const ADVISORY_LOCK = Symbol('ADVISORY_LOCK');

/**
 * The `JobRunRecorder` `IdempotentJobRunner` writes each run's summary through.
 * `BackgroundJobsModule.forRoot()` binds this to `NoopJobRunRecorder` unless the
 * consumer passes `jobRunRecorderToken` (e.g. `POSTGRES_JOB_RUN_RECORDER` from
 * `background-jobs.core.postgres-drizzle`).
 */
export const JOB_RUN_RECORDER = Symbol('JOB_RUN_RECORDER');

/**
 * A `JobObservabilityPort` implementation — the run-history + jobs-dashboard
 * reads for an admin screen. A stack adapter's observability module binds it
 * (`PostgresJobObservabilityModule` does); `background-jobs.api` consumes it.
 * Never touched by the runner or feature code.
 */
export const JOB_OBSERVABILITY_PORT = Symbol('JOB_OBSERVABILITY_PORT');

/**
 * A `JobLockInspectorPort` — the Lock Inspector's read. Bound only by a lock adapter that can list its locks
 * (`PostgresLeaseLockInspectorModule`); `background-jobs.api` injects it optionally.
 */
export const JOB_LOCK_INSPECTOR_PORT = Symbol('JOB_LOCK_INSPECTOR_PORT');
