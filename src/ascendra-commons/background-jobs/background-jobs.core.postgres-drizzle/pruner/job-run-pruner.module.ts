import { DynamicModule, Module } from '@nestjs/common';
import { JobRunPrunerJob } from './job-run-pruner.job';
import { JOB_RUN_APPLICATION_ID, JOB_RUN_RETENTION_DAYS, JOB_RUN_SQL_EXECUTOR } from '../tokens';

export interface JobRunPrunerModuleConfig {
  /** The token the consuming app provides its Drizzle db under — the normal pooled connection is fine. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /** Which Ascendra application this process is — the pruner's DELETE is scoped to it. */
  application: string;

  /** `commons_jobs_job_run` rows older than this many days are deleted each run. Default 90. */
  retentionDays?: number;

  /**
   * Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only
   * if that provider's own module is `global: true`.
   */
  imports?: DynamicModule['imports'];
}

/**
 * Provides `JobRunPrunerJob` bound to the consumer's db, application, and
 * retention. The job is inert until the consumer gives it a cadence:
 *
 * ```typescript
 * @Injectable()
 * export class JobRunPrunerSchedule implements OnApplicationBootstrap {
 *   constructor(private readonly runner: IdempotentJobRunner, private readonly job: JobRunPrunerJob) {}
 *   async onApplicationBootstrap() { await this.runner.run(this.job, { trigger: 'bootstrap' }); }
 *   @Cron('30 3 * * *') async scheduledRun() { await this.runner.run(this.job); }
 * }
 * ```
 *
 * A dynamic module because the db token and application string have no sensible
 * default.
 */
@Module({})
export class JobRunPrunerModule {
  static forRoot(config: JobRunPrunerModuleConfig): DynamicModule {
    return {
      module: JobRunPrunerModule,
      imports: config.imports ?? [],
      providers: [
        { provide: JOB_RUN_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: JOB_RUN_APPLICATION_ID, useValue: config.application },
        { provide: JOB_RUN_RETENTION_DAYS, useValue: config.retentionDays ?? 90 },
        JobRunPrunerJob,
      ],
      exports: [JobRunPrunerJob],
    };
  }
}
