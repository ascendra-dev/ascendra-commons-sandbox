import { Inject, Injectable } from '@nestjs/common';
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
 * `trigger()` awaits the whole run. For a job that can take a while, the
 * consumer's controller should not hold the HTTP request open — fire it and
 * return `202`, then let the admin screen poll the run history:
 * `void jobTrigger.trigger(name)`. The advisory lock still prevents a
 * double-click from starting a second run.
 *
 * Gate the endpoint with the app's own `Authorizer` — a manual job run is a
 * privileged operation. This service does no authorization of its own.
 */
@Injectable()
export class JobTrigger {
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

  /** The job names a UI can offer to trigger. */
  availableJobs(): string[] {
    return this.registry.names();
  }
}
