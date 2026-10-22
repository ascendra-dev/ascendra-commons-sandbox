import { DynamicModule, Module } from '@nestjs/common';
import { PostgresJobRunRecorder } from './postgres-job-run-recorder';
import { JOB_RUN_APPLICATION_ID, JOB_RUN_SQL_EXECUTOR, POSTGRES_JOB_RUN_RECORDER } from '../tokens';

export interface PostgresJobRunRecorderModuleConfig {
  /**
   * The token the consuming app provides its Drizzle db under. Aliased via
   * `useExisting`, never constructed here (same reasoning
   * `BackgroundJobsModule.forRoot()` gives). This should be the app's *normal
   * pooled* connection — unlike the core's `SQL_EXECUTOR`, the recorder has no
   * connection-affinity requirement and its writes should not be serialized
   * through the advisory lock's dedicated connection.
   */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /**
   * Which Ascendra application this process is (e.g. `'ascendra-pay'`) —
   * stamped into every `commons_jobs_job_run` row's `application` column.
   */
  application: string;

  /**
   * Whatever module(s) export the provider behind `sqlExecutorToken`.
   * `useExisting` only resolves a token NestJS can already see in *this*
   * module's own providers or imports. Omit only if that provider's own module
   * is `global: true`.
   */
  imports?: DynamicModule['imports'];
}

/**
 * Wires the reference `PostgresJobRunRecorder` and exports it under
 * `POSTGRES_JOB_RUN_RECORDER`. Pass that token — and this module in the same
 * `imports` array — to `BackgroundJobsModule.forRoot()`:
 *
 * ```typescript
 * BackgroundJobsModule.forRoot({
 *   sqlExecutorToken: SCHEDULER_DB,            // dedicated single connection — the advisory lock
 *   imports: [
 *     SchedulerDbModule,
 *     PostgresJobRunRecorderModule.forRoot({
 *       sqlExecutorToken: DRIZZLE,             // the app's normal pooled db — run telemetry
 *       application: 'ascendra-pay',
 *       imports: [],                           // DRIZZLE is @Global in pay-api
 *     }),
 *   ],
 *   jobRunRecorderToken: POSTGRES_JOB_RUN_RECORDER,
 * })
 * ```
 *
 * A dynamic module because neither the db token nor the application string has
 * a sensible default.
 */
@Module({})
export class PostgresJobRunRecorderModule {
  static forRoot(config: PostgresJobRunRecorderModuleConfig): DynamicModule {
    return {
      module: PostgresJobRunRecorderModule,
      imports: config.imports ?? [],
      providers: [
        { provide: JOB_RUN_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: JOB_RUN_APPLICATION_ID, useValue: config.application },
        PostgresJobRunRecorder,
        { provide: POSTGRES_JOB_RUN_RECORDER, useExisting: PostgresJobRunRecorder },
      ],
      exports: [POSTGRES_JOB_RUN_RECORDER],
    };
  }
}
