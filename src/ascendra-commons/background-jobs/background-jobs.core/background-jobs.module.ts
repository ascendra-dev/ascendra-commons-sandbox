import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { IdempotentJobRunner } from './idempotent-job-runner.service';
import { JobTrigger } from './job-trigger';
import { NoopJobRunRecorder } from './noop-job-run-recorder';
import { ScheduledJob } from './scheduled-job.port';
import { ScheduledJobRegistry } from './scheduled-job-registry';
import { ADVISORY_LOCK, JOB_RUN_RECORDER } from './tokens';

type OverrideToken = string | symbol | (new (...args: never[]) => unknown);

export interface BackgroundJobsModuleConfig {
  /**
   * **Required.** The token an `AdvisoryLock` implementation is provided under
   * by a module in `imports`:
   *
   *   - `POSTGRES_ADVISORY_LOCK` — session-level `pg_try_advisory_lock` (needs a
   *     dedicated single connection; not usable through a transaction-mode pooler)
   *   - `POSTGRES_LEASE_LOCK` — a `commons_jobs_lock` row with a lease (any
   *     pooled connection; works through any pooler)
   *
   * both from `background-jobs.core.postgres-drizzle`, or your own on another
   * stack. `.core` ships no lock implementation and no `SqlExecutor` of its own.
   */
  advisoryLockToken: OverrideToken;

  /**
   * Optional. The token a `JobRunRecorder` implementation is provided under —
   * e.g. `POSTGRES_JOB_RUN_RECORDER`. Omit and run-history recording is a no-op
   * (`NoopJobRunRecorder`). Whatever module exports it must be in `imports`.
   */
  jobRunRecorderToken?: OverrideToken;

  /**
   * Optional. `ScheduledJob` provider classes an admin can run on demand by
   * name via `JobTrigger` — the hook behind a "run now" / "retry" button. Each
   * must be resolvable from `imports`. A job left out still runs on its `@Cron`;
   * it just can't be triggered out of schedule.
   */
  jobs?: Array<Type<ScheduledJob<unknown>>>;

  /**
   * Whatever module(s) export the token(s) above. `useExisting` only resolves a
   * token NestJS can already see in *this* module's own providers or imports.
   */
  imports?: DynamicModule['imports'];
}

/**
 * The model-agnostic core. `forRoot()` binds `ADVISORY_LOCK` to
 * `advisoryLockToken` and `JOB_RUN_RECORDER` (real or no-op), and provides
 * `IdempotentJobRunner` + `JobTrigger` + `ScheduledJobRegistry`. It schedules
 * nothing itself — each job gets its own thin `@Cron` / `OnApplicationBootstrap`
 * wiring class around the shared runner (see this module's README).
 */
@Module({})
export class BackgroundJobsModule {
  static forRoot(config: BackgroundJobsModuleConfig): DynamicModule {
    if (!config?.advisoryLockToken) {
      throw new Error(
        'BackgroundJobsModule.forRoot() requires advisoryLockToken — POSTGRES_ADVISORY_LOCK or ' +
          'POSTGRES_LEASE_LOCK from background-jobs.core.postgres-drizzle, or your own AdvisoryLock token.',
      );
    }

    const recorderProvider: Provider = config.jobRunRecorderToken
      ? { provide: JOB_RUN_RECORDER, useExisting: config.jobRunRecorderToken }
      : { provide: JOB_RUN_RECORDER, useClass: NoopJobRunRecorder };

    const registryProvider: Provider = {
      provide: ScheduledJobRegistry,
      useFactory: (...jobs: ScheduledJob<unknown>[]) => new ScheduledJobRegistry(jobs),
      inject: config.jobs ?? [],
    };

    return {
      module: BackgroundJobsModule,
      imports: config.imports ?? [],
      providers: [
        { provide: ADVISORY_LOCK, useExisting: config.advisoryLockToken },
        recorderProvider,
        IdempotentJobRunner,
        registryProvider,
        JobTrigger,
      ],
      exports: [IdempotentJobRunner, JobTrigger, ScheduledJobRegistry],
    };
  }
}
