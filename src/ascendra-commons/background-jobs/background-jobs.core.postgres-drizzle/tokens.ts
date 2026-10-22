/**
 * Injection tokens for the Postgres/Drizzle adapter. Symbols, not string
 * literals. The observability read is bound under `JOB_OBSERVABILITY_PORT`
 * (from `background-jobs.core`), not an adapter-specific token.
 */

// --- advisory lock (session-level pg_try_advisory_lock — needs a dedicated single connection) ---
export const ADVISORY_LOCK_SQL_EXECUTOR = Symbol('ADVISORY_LOCK_SQL_EXECUTOR');
export const POSTGRES_ADVISORY_LOCK = Symbol('POSTGRES_ADVISORY_LOCK');

// --- lease lock (commons_jobs_lock row — any pooled connection) ---
export const LEASE_LOCK_SQL_EXECUTOR = Symbol('LEASE_LOCK_SQL_EXECUTOR');
export const LEASE_LOCK_APPLICATION_ID = Symbol('LEASE_LOCK_APPLICATION_ID');
export const LEASE_LOCK_SECONDS = Symbol('LEASE_LOCK_SECONDS');
export const POSTGRES_LEASE_LOCK = Symbol('POSTGRES_LEASE_LOCK');

// --- run recorder + observability + pruner (shared db + application; the normal pooled connection) ---
export const JOB_RUN_SQL_EXECUTOR = Symbol('JOB_RUN_SQL_EXECUTOR');
export const JOB_RUN_APPLICATION_ID = Symbol('JOB_RUN_APPLICATION_ID');
export const JOB_RUN_RETENTION_DAYS = Symbol('JOB_RUN_RETENTION_DAYS');
export const JOB_OBSERVABILITY_CADENCES = Symbol('JOB_OBSERVABILITY_CADENCES');
export const POSTGRES_JOB_RUN_RECORDER = Symbol('POSTGRES_JOB_RUN_RECORDER');
