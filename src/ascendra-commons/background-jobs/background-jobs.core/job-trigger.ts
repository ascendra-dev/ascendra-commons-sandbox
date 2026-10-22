import { Inject, Injectable, Logger } from '@nestjs/common';
import { IdempotentJobRunner } from './idempotent-job-runner.service';
import { ScheduledJobRegistry } from './scheduled-job-registry';

export type JobTriggerResult =
  | { status: 'unknown_job' }
  /** The advisory lock was held — a scheduled fire or another trigger is already running this job. */
  | { status: 'already_running' }
  | {
      status: 'completed';
      itemsDue: number;
      itemsProcessed: number;
      itemsFailed: number;
      /** `describeItem()` output for items that failed this run, capped. */
      failedItemRefs: string[];
    }
  /** `findDueItems()` threw — nothing was processed. The run is still recorded (as `job_failed`). */
  | { status: 'job_failed'; error: string };

/**
 * `start()`'s answer — given as soon as it's known whether the job runs, never after the run. A started run's result
 * lands in the run history, tagged with the correlation id it was started with.
 */
export type JobStartResult =
  | { status: 'unknown_job' }
  /** The lock was held — a scheduled fire or another trigger is already running this job. */
  | { status: 'already_running' }
  /** The lock is taken and the run is under way. */
  | { status: 'started' };

/**
 * An out-of-schedule, admin-initiated run of a job by name — the hook behind a
 * "run now" / "retry" button on a run-history admin screen.
 *
 * "Retry" and "run now" are the same operation: `run()` calls `findDueItems()`
 * fresh, so if the job is **level-triggered** (returns what is *still* due — the
 * shape this module asks for), the items that failed last run are still due and
 * are retried. It is not per-item retry — `failedItemRefs` are opaque strings,
 * and the runner can't turn one back into an item to process alone. Per-item
 * retry state is a Model 2 concern.
 *
 * `trigger()` awaits the whole run — for a script or a test. Behind an HTTP
 * endpoint use `start()`: it answers once the lock is taken (or found held), so
 * a long job never holds the request open past a proxy's timeout, and the
 * screen follows the run in the history by its correlation id. Either way the
 * lock stops a double-click from starting a second run.
 *
 * Gate the endpoint with the app's own `Authorizer` — a manual job run is a
 * privileged operation. This service does no authorization of its own.
 */
@Injectable()
export class JobTrigger {
  private readonly logger = new Logger(JobTrigger.name);

  constructor(
    // Explicit @Inject even though the token is the class itself — this library's
    // build/test setup does not emit `design:paramtypes`, so every constructor
    // param is bound by an explicit token (see any other module here).
    @Inject(ScheduledJobRegistry) private readonly registry: ScheduledJobRegistry,
    @Inject(IdempotentJobRunner) private readonly runner: IdempotentJobRunner,
  ) {}

  /**
   * @param correlationId  the ambient request/trace id, if the controller has one —
   *   recorded on the run so it can be joined to `commons_audit_event` /
   *   `commons_notification_delivery` for a cross-module trace.
   */
  async trigger(jobName: string, correlationId?: string): Promise<JobTriggerResult> {
    const job = this.registry.get(jobName);
    if (!job) return { status: 'unknown_job' };

    try {
      const summary = await this.runner.run(job, { trigger: 'manual', correlationId });
      if (!summary) return { status: 'already_running' };
      return {
        status: 'completed',
        itemsDue: summary.itemsDue,
        itemsProcessed: summary.itemsProcessed,
        itemsFailed: summary.itemsFailed,
        failedItemRefs: summary.failedItemRefs,
      };
    } catch (err) {
      // findDueItems() threw — run() recorded the job_failed summary, then rethrew.
      return { status: 'job_failed', error: err instanceof Error ? (err.stack ?? err.message) : String(err) };
    }
  }

  /**
   * Starts the job and answers as soon as it's known whether it runs: `started` once the lock is taken, before any
   * work; `already_running` if the lock is held; `unknown_job` if no job has the name. The run goes on after this
   * resolves, and is recorded like any other — a `findDueItems()` failure as `job_failed` — so its result is read
   * from the run history (`getTrace(correlationId)`). Rejects only if the lock itself couldn't be asked for.
   *
   * @param correlationId  tags the run, so the caller can find it in the history — pass one, or it can't.
   */
  start(jobName: string, correlationId?: string): Promise<JobStartResult> {
    const job = this.registry.get(jobName);
    if (!job) return Promise.resolve({ status: 'unknown_job' });

    return new Promise((resolve, reject) => {
      let started = false;
      this.runner
        .run(job, {
          trigger: 'manual',
          correlationId,
          onStarted: () => {
            started = true;
            resolve({ status: 'started' });
          },
        })
        .then((summary) => {
          if (!summary) resolve({ status: 'already_running' });
        })
        .catch((err) => {
          // Before the start: the lock couldn't be asked for — the caller's error. After it: findDueItems() threw,
          // and the run is already recorded as job_failed — nobody is awaiting this promise any more, so log it.
          if (!started) return reject(err);
          this.logger.warn(
            `Job "${jobName}", started by hand, failed — recorded as job_failed`,
            err instanceof Error ? err.stack : String(err),
          );
        });
    });
  }

  /** The job names a UI can offer to trigger. */
  availableJobs(): string[] {
    return this.registry.names();
  }
}
