import { DynamicModule, Module } from '@nestjs/common';
import { JOB_OBSERVABILITY_PORT } from '../../background-jobs.core';
import { PostgresJobObservabilityService } from './postgres-job-observability.service';
import { JOB_OBSERVABILITY_CADENCES, JOB_RUN_APPLICATION_ID, JOB_RUN_SQL_EXECUTOR } from '../tokens';

export interface PostgresJobObservabilityModuleConfig {
  /** The token the consuming app provides its Drizzle db under — the normal pooled connection is fine (reads only). */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /** Which Ascendra application this process is — every query is scoped to it. */
  application: string;
  /**
   * Optional per-job cadence hint — a rough "if it hasn't run in this long,
   * something is wrong" bound, **not** the real cron. `'1d'` / `'2h'` / `'30m'`
   * / `'90s'`, or a number of seconds. Keys also seed the dashboard's job list.
   * A bad value throws at startup.
   */
  cadences?: Record<string, string | number>;
  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Binds `PostgresJobObservabilityService` under the core `JOB_OBSERVABILITY_PORT`
 * token, so `background-jobs.api` (or your own controller) depends on the port,
 * not on Postgres. `getRunHistory()` (drill-down) + `listJobStatus()`
 * (dashboard, with overdue detection).
 */
@Module({})
export class PostgresJobObservabilityModule {
  static forRoot(config: PostgresJobObservabilityModuleConfig): DynamicModule {
    return {
      module: PostgresJobObservabilityModule,
      imports: config.imports ?? [],
      providers: [
        { provide: JOB_RUN_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: JOB_RUN_APPLICATION_ID, useValue: config.application },
        { provide: JOB_OBSERVABILITY_CADENCES, useValue: config.cadences ?? {} },
        PostgresJobObservabilityService,
        { provide: JOB_OBSERVABILITY_PORT, useExisting: PostgresJobObservabilityService },
      ],
      exports: [JOB_OBSERVABILITY_PORT],
    };
  }
}
