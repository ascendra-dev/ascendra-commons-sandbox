/**
 * Job-run observability — the port. `IdempotentJobRunner` assembles one
 * `JobRunSummary` per execution that acquired the lock and hands it to a
 * `JobRunRecorder`. The runner itself has no persistence and no opinion on
 * where a summary goes — `adapters/postgres-drizzle` is one implementation;
 * `NoopJobRunRecorder` is the default when the consumer doesn't opt in.
 *
 * A "run" is one call to `run()` that got the lock and executed. A
 * lock-not-acquired return (a rolling deploy's overlap window, another
 * instance already working) is *not* a run and is never recorded — it would
 * be frequent, uninteresting noise.
 *
 * "Missed schedule" is not recorded here — you cannot write a row for a run
 * that never happened. It is derived downstream: "no `completed` run for job
 * X in longer than its cadence." The `trigger` field helps: a run of
 * `'bootstrap'` that processed a large batch means scheduled fires were being
 * missed and the `OnApplicationBootstrap` catch-up compensated.
 */

/** Why `run()` was called — the schedule wrapper knows this, the runner doesn't, so it's passed in. */
export type JobRunTrigger = 'scheduled' | 'bootstrap' | 'manual';

/**
 * `'job_failed'` means `findDueItems()` itself threw — nothing was processed.
 * A run where some `processItem()` calls threw is still `'completed'`, with
 * `itemsFailed > 0`: those items simply stayed due and retry next run.
 */
export type JobRunOutcome = 'completed' | 'job_failed';

export interface JobRunSummary {
  jobName: string;
  trigger: JobRunTrigger;
  startedAt: Date;
  finishedAt: Date;
  outcome: JobRunOutcome;
  /** `findDueItems()`'s result length — 0 on a `'job_failed'` run. */
  itemsDue: number;
  itemsProcessed: number;
  itemsFailed: number;
  /**
   * `describeItem()` output for the items that failed this run, capped (see
   * `IdempotentJobRunner`'s `MAX_FAILED_ITEM_REFS`). A diagnosis aid — "invoice
   * a1b2 has failed the last 6 runs" becomes a query — not a dead-letter queue;
   * per-item retry policy is Model 2.
   */
  failedItemRefs: string[];
  /** The job-level error's stack, present only when `outcome === 'job_failed'`. */
  error?: string;
  /**
   * The request/trace id this run belongs to, when the caller supplies one via
   * `JobRunOptions.correlationId` — normally only for a `'manual'` trigger
   * fired from an HTTP request. Recorded so a run can be joined to the same id
   * in `commons_audit_event` / `commons_notification_delivery` for a
   * cross-module trace.
   */
  correlationId?: string;
}

export interface JobRunRecorder {
  /**
   * Persist one run's summary. **Best-effort by contract: an implementation
   * must not throw** — a failure to record a run must never mask or compound
   * the real job outcome. This is the opposite posture to `audit-logging`'s
   * `AuditEventRepository`, where a failed write is critical and should roll
   * the triggering operation back. `IdempotentJobRunner` also guards this
   * call, but every implementation is expected to honor the contract itself.
   */
  recordRun(summary: JobRunSummary): Promise<void>;
}
