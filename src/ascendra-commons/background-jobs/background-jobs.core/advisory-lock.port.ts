/**
 * A distributed, cross-instance mutex keyed by string. Defined separately
 * from IdempotentJobRunner so the runner's own logic (per-item iteration,
 * failure isolation) is testable against a fake lock, without needing a real
 * Postgres connection for every test — only PostgresAdvisoryLock's own spec
 * needs that.
 */
export interface AdvisoryLock {
  /** Non-blocking: returns false immediately if another instance already holds this key, rather than waiting. */
  tryAcquire(key: string): Promise<boolean>;
  release(key: string): Promise<void>;
}
