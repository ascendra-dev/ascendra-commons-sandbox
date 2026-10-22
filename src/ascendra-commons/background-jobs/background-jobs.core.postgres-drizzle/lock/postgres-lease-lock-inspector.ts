import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { JobLockInspectorPort, JobLockView } from '../../background-jobs.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { LEASE_LOCK_APPLICATION_ID, LEASE_LOCK_SQL_EXECUTOR } from '../tokens';

/** The prefix `IdempotentJobRunner` puts on every lock key it takes. */
const RUNNER_KEY_PREFIX = 'scheduler:';

/**
 * `JobLockInspectorPort` over `PostgresLeaseLock`'s `commons_jobs_lock` rows. A released lock's row is deleted, so a
 * row is either a run in progress (`held`) or a holder that died mid-run (`expired` — the lease lapsed, the row
 * stayed). `state` is decided by the database's clock, the same clock `tryAcquire` takes over by. Read-only; the
 * primary key `(application, lock_key)` bounds and serves the scan.
 */
@Injectable()
export class PostgresLeaseLockInspector implements JobLockInspectorPort {
  constructor(
    @Inject(LEASE_LOCK_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(LEASE_LOCK_APPLICATION_ID) private readonly application: string,
  ) {}

  async listLocks(): Promise<JobLockView[]> {
    const { rows } = await this.db.execute(sql`
      select lock_key, holder, acquired_at, locked_until, locked_until < now() as expired
      from commons_jobs_lock
      where application = ${this.application}
      order by acquired_at, lock_key
    `);
    return rows.map((row) => {
      const lockKey = String(row.lock_key);
      return {
        lockKey,
        jobName: lockKey.startsWith(RUNNER_KEY_PREFIX) ? lockKey.slice(RUNNER_KEY_PREFIX.length) : null,
        holder: String(row.holder),
        acquiredAt: asDate(row.acquired_at),
        lockedUntil: asDate(row.locked_until),
        state: row.expired === true || row.expired === 't' ? 'expired' : 'held',
      };
    });
  }
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}
