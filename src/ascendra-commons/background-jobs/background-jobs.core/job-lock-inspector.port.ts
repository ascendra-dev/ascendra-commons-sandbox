/**
 * Which job locks are held right now — the Lock Inspector. Read-only: a force-release would be a separate, dangerous,
 * audited action (not built). Bound under `JOB_LOCK_INSPECTOR_PORT` by a lock adapter that *can* say: the lease lock's
 * rows can be listed; a session-level `pg_try_advisory_lock` leaves nothing a reader can attribute to a job, so an app
 * on it binds nothing and `background-jobs.api` answers `supported: false`.
 */
export interface JobLockView {
  /** The lock's key — `scheduler:<job name>` for a lock `IdempotentJobRunner` took. */
  lockKey: string;
  /** The job the key belongs to, or `null` for a key the runner didn't take. */
  jobName: string | null;
  /** Which process holds it — `host#pid#nonce` for `PostgresLeaseLock`. */
  holder: string;
  acquiredAt: Date;
  /** When the lease runs out. A live holder keeps extending it; one that crashed lets it lapse. */
  lockedUntil: Date;
  /**
   * `'held'` — within its lease (a run in progress). `'expired'` — the lease lapsed and the row is still there: its
   * holder died mid-run, and the job stays blocked until the next run takes the lock over.
   */
  state: 'held' | 'expired';
}

export interface JobLockInspectorPort {
  /** Every lock row for this application, oldest first. */
  listLocks(): Promise<JobLockView[]>;
}
