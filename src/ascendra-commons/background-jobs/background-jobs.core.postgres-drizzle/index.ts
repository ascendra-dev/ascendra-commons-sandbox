// Schema — tables for typed queries; never re-export them to drizzle-kit (the DDL is migrations/)
export { jobRunTable } from './run-recorder/job-run.schema';
export { leaseLockTable } from './lock/lease-lock.schema';
export type { SqlExecutor } from './persistence/sql-executor';

// Advisory lock — pick ONE
export { PostgresAdvisoryLock } from './lock/postgres-advisory-lock';
export { PostgresAdvisoryLockModule } from './lock/postgres-advisory-lock.module';
export type { PostgresAdvisoryLockModuleConfig } from './lock/postgres-advisory-lock.module';
export { PostgresLeaseLock } from './lock/postgres-lease-lock';
export { PostgresLeaseLockModule } from './lock/postgres-lease-lock.module';
export type { PostgresLeaseLockModuleConfig } from './lock/postgres-lease-lock.module';
// Lock Inspector (implements JobLockInspectorPort) — lease lock only
export { PostgresLeaseLockInspector } from './lock/postgres-lease-lock-inspector';
export { PostgresLeaseLockInspectorModule } from './lock/postgres-lease-lock-inspector.module';
export type { PostgresLeaseLockInspectorModuleConfig } from './lock/postgres-lease-lock-inspector.module';

// Run recorder
export { PostgresJobRunRecorder } from './run-recorder/postgres-job-run-recorder';
export { PostgresJobRunRecorderModule } from './run-recorder/postgres-job-run-recorder.module';
export type { PostgresJobRunRecorderModuleConfig } from './run-recorder/postgres-job-run-recorder.module';

// Observability (implements JobObservabilityPort)
export { PostgresJobObservabilityService } from './observability/postgres-job-observability.service';
export { PostgresJobObservabilityModule } from './observability/postgres-job-observability.module';
export type { PostgresJobObservabilityModuleConfig } from './observability/postgres-job-observability.module';

// Reference pruner ScheduledJob — keeps commons_jobs_job_run bounded
export { JobRunPrunerJob } from './pruner/job-run-pruner.job';
export { JobRunPrunerModule } from './pruner/job-run-pruner.module';
export type { JobRunPrunerModuleConfig } from './pruner/job-run-pruner.module';

export {
  POSTGRES_ADVISORY_LOCK,
  POSTGRES_LEASE_LOCK,
  POSTGRES_JOB_RUN_RECORDER,
  ADVISORY_LOCK_SQL_EXECUTOR,
  LEASE_LOCK_SQL_EXECUTOR,
  JOB_RUN_SQL_EXECUTOR,
} from './tokens';
