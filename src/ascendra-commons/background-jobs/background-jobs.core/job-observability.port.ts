import type {
  FailedItemSummary,
  JobRunRecord,
  JobStatus,
  RunHistoryPage,
  RunHistoryQuery,
  RunPeriodQuery,
  RunSummary,
  RunVolume,
} from './job-observability.types';

/**
 * Read-only reporting over job-run history for an admin screen — the run
 * drill-down log (`getRunHistory`) and the jobs dashboard (`listJobStatus`,
 * with overdue detection). Bound under `JOB_OBSERVABILITY_PORT` by a stack
 * adapter; consumed by `background-jobs.api`. Never mutates — `JobRunRecorder`
 * owns writes.
 *
 * "Missed schedule" is not stored (you can't write a row for a run that never
 * happened) — it's *derived* in `listJobStatus` from a per-job cadence hint.
 */
export interface JobObservabilityPort {
  /**
   * Recent runs, newest first, keyset-paginated. `error` is truncated on each
   * row (an unbounded stack trace on a list payload is an info-leak risk, not
   * just noise) — fetch the full stack via `getRun`.
   */
  getRunHistory(query?: RunHistoryQuery): Promise<RunHistoryPage>;
  /** One row per job — every job that has ever run, plus every job with a declared cadence. Same truncated `error` as `getRunHistory`. */
  listJobStatus(): Promise<JobStatus[]>;
  /**
   * One run by id, with the full, untruncated `error` stack (unlike the list
   * projections above) — the run-detail permalink. `null` if no such run
   * exists for this application.
   */
  getRun(id: string): Promise<JobRunRecord | null>;
  /**
   * Items from `failedItemRefs` that recur across multiple failed runs of
   * `jobName` — the "chronic offender" view for triage. Scans a recent window
   * of that job's runs (not its whole history) and returns every ref that
   * appeared as a failed item in at least `minRuns` of them (default: an
   * adapter-chosen small number, e.g. 2), newest/most-frequent first.
   *
   * Best-effort, not exact: `describeItem()` output is a logging aid, not a
   * contract — it isn't guaranteed to be a stable identifier for "the same
   * item" across runs. A job whose `describeItem()` embeds something that
   * varies run to run (an index, a timestamp) will never show a recurrence
   * here even if the same underlying item keeps failing; matching is only as
   * reliable as that job's own `describeItem()`. Not a dead-letter queue —
   * per-item retry state is a Model 2 concern.
   */
  getFailedItems(jobName: string, minRuns?: number): Promise<FailedItemSummary[]>;
  /** The Overview's totals over a period, counted by `startedAt`. */
  runSummary(query?: RunPeriodQuery): Promise<RunSummary>;
  /** Per-day runs for 30 calendar days in `timeZone` (IANA, default UTC), and the table's extent. */
  volume(timeZone?: string, now?: Date): Promise<RunVolume>;
}
