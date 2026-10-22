import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AdvisoryLock } from './advisory-lock.port';
import { JobRunOutcome, JobRunRecorder, JobRunSummary, JobRunTrigger } from './job-run-recorder.port';
import { NoopJobRunRecorder } from './noop-job-run-recorder';
import { ScheduledJob } from './scheduled-job.port';
import { ADVISORY_LOCK, JOB_RUN_RECORDER } from './tokens';

/** How many failed-item refs a single run's summary carries — a diagnosis sample, not a full list. */
const MAX_FAILED_ITEM_REFS = 50;

export interface JobRunOptions {
  /**
   * Why this run was triggered — recorded on the run summary so the history can
   * tell a normal scheduled fire from an `OnApplicationBootstrap` catch-up or an
   * admin-triggered run. Defaults to `'scheduled'`.
   */
  trigger?: JobRunTrigger;
  /**
   * The ambient request/trace id, when there is one — normally only for a
   * `'manual'` trigger from an HTTP request (`JobTrigger` forwards it).
   * Recorded on the run summary for a cross-module trace.
   */
  correlationId?: string;
  /**
   * Called once the lock is taken, before `findDueItems()` — the moment this is
   * a run. `JobTrigger.start()` answers its caller here and lets the run go on.
   * Never called when the lock was held (`run()` resolves `null`). A throw from
   * it is logged and ignored: it can't stop the run it announces.
   */
  onStarted?: () => void;
}

/**
 * The safety mechanism, implemented once for every scheduled job in the
 * application. Has no opinion on what a job's items are, what "due" means,
 * or when it should run (see the module README for scheduling composition) —
 * only on running it safely: no duplicate concurrent execution, no single
 * item's failure blocking the rest of a batch or a future run.
 */
@Injectable()
export class IdempotentJobRunner {
  private readonly logger = new Logger(IdempotentJobRunner.name);
  private readonly recorder: JobRunRecorder;

  constructor(
    @Inject(ADVISORY_LOCK) private readonly lock: AdvisoryLock,
    @Optional() @Inject(JOB_RUN_RECORDER) recorder?: JobRunRecorder,
  ) {
    // BackgroundJobsModule.forRoot() always binds JOB_RUN_RECORDER; the fallback
    // keeps `new IdempotentJobRunner(lock)` (tests, ad hoc wiring) working.
    this.recorder = recorder ?? new NoopJobRunRecorder();
  }

  /**
   * Resolves with the run's {@link JobRunSummary} on a completed run (even one
   * with `itemsFailed > 0`), or `null` if the advisory lock was not acquired
   * (another instance or an overlapping run already owns the job — not a run,
   * not recorded). **Rejects** if `findDueItems()` itself threw — the
   * `job_failed` summary is recorded first, then the error propagates, so the
   * scheduled `@Cron` caller still learns the whole job failed to even query.
   * `JobTrigger` turns that rejection into a `job_failed` result for a UI.
   */
  async run(job: ScheduledJob<unknown>, options?: JobRunOptions): Promise<JobRunSummary | null> {
    const lockKey = `scheduler:${job.name}`;
    const acquired = await this.lock.tryAcquire(lockKey);
    if (!acquired) return null; // another instance already owns this job — including a rolling deploy's overlap window. Not a run; not recorded.
    this.announceStart(job, options);

    const startedAt = new Date();
    let itemsDue = 0;
    let itemsProcessed = 0;
    let itemsFailed = 0;
    const failedItemRefs: string[] = [];
    let outcome: JobRunOutcome = 'completed';
    let jobError: string | undefined;
    let summary: JobRunSummary | undefined;

    try {
      const due = await job.findDueItems();
      itemsDue = due.length;
      for (let i = 0; i < due.length; i++) {
        try {
          await job.processItem(due[i]);
          itemsProcessed++;
        } catch (err) {
          // One item's failure never blocks the rest of the batch — it simply stays "due"
          // (processItem never got to mark it) and is picked up again on the very next run.
          itemsFailed++;
          const ref = this.describe(job, due[i], i, due.length);
          if (failedItemRefs.length < MAX_FAILED_ITEM_REFS) failedItemRefs.push(ref);
          this.logger.error(
            `Scheduled job "${job.name}" failed on ${ref} — it stays due and retries next run`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    } catch (err) {
      // findDueItems() itself threw — a job-level failure, distinct from a single item's.
      // The error still propagates out of run() (the caller learns the whole job failed to
      // even query), but the run is recorded as job_failed first, in the finally block.
      outcome = 'job_failed';
      jobError = err instanceof Error ? (err.stack ?? err.message) : String(err);
      throw err;
    } finally {
      // Always released, even if findDueItems() threw. Guarded so a failure to *unlock* can
      // never replace the primary error propagating out of the try block (a rejecting await
      // in finally would otherwise mask it).
      await this.lock.release(lockKey).catch((err) =>
        this.logger.error(
          `Scheduled job "${job.name}" failed to release its advisory lock "${lockKey}"`,
          err instanceof Error ? err.stack : String(err),
        ),
      );
      summary = {
        jobName: job.name,
        trigger: options?.trigger ?? 'scheduled',
        startedAt,
        finishedAt: new Date(),
        outcome,
        itemsDue,
        itemsProcessed,
        itemsFailed,
        failedItemRefs,
        error: jobError,
        correlationId: options?.correlationId,
      };
      await this.record(summary);
    }

    // The finally block above always assigns `summary` before this line is reached;
    // `?? null` only satisfies the type-checker, which can't see that.
    return summary ?? null;
  }

  /**
   * Best-effort — a failure to record the run is logged, never thrown. Telemetry
   * about a run must not become a way for that run to fail (contrast audit-logging,
   * where a failed write is critical by design).
   */
  private async record(summary: JobRunSummary): Promise<void> {
    try {
      await this.recorder.recordRun(summary);
    } catch (err) {
      this.logger.error(
        `Scheduled job "${summary.jobName}" ran, but recording its run failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private announceStart(job: ScheduledJob<unknown>, options?: JobRunOptions): void {
    try {
      options?.onStarted?.();
    } catch (err) {
      this.logger.error(`Scheduled job "${job.name}": its onStarted callback threw`, err instanceof Error ? err.stack : String(err));
    }
  }

  /** Never throws — a job's describeItem() is a logging aid, not part of the batch's success path. */
  private describe(job: ScheduledJob<unknown>, item: unknown, index: number, total: number): string {
    const fallback = `item ${index + 1}/${total}`;
    if (!job.describeItem) return fallback;
    try {
      return job.describeItem(item);
    } catch {
      return fallback;
    }
  }
}
