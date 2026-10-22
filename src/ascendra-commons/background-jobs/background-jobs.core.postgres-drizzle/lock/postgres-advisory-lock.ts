import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AdvisoryLock } from '../../background-jobs.core';
import { SqlExecutor } from '../persistence/sql-executor';
import { ADVISORY_LOCK_SQL_EXECUTOR } from '../tokens';

/**
 * Postgres session-level advisory locks (Model 1). hashtext() folds an
 * arbitrary string key into the bigint pg_try_advisory_lock() needs, so
 * callers never manage numeric lock ids themselves. Session-scoped locks are
 * released automatically by Postgres when the holding connection closes, so
 * a crashed process never leaves one stuck — nothing here has to handle that
 * case explicitly.
 *
 * REQUIRED — the provider behind SQL_EXECUTOR must give tryAcquire() and
 * release() the *same* physical session. A session-level lock belongs to one
 * connection; if the two calls land on different connections of a pool, the
 * unlock is a no-op on a connection that never held the lock, the real holder
 * keeps the lock until it is idle-closed, and the job silently skips every run
 * in between. So:
 *   - Never point SQL_EXECUTOR at a transaction-mode pooler (PgBouncer /
 *     Supabase "Transaction pooler") — session-level advisory locks are
 *     unsupported there.
 *   - Give SQL_EXECUTOR a dedicated single connection, distinct from the app
 *     pool — e.g. `drizzle(new Pool({ max: 1, idleTimeoutMillis: 0 }))` — so
 *     acquire and release always share one session.
 * release() logs a WARN if pg_advisory_unlock reports the lock was not held:
 * the canary that one of the above is misconfigured. See the module README.
 */
@Injectable()
export class PostgresAdvisoryLock implements AdvisoryLock {
  private readonly logger = new Logger(PostgresAdvisoryLock.name);

  constructor(@Inject(ADVISORY_LOCK_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async tryAcquire(key: string): Promise<boolean> {
    const result = await this.db.execute(sql`select pg_try_advisory_lock(hashtext(${key})) as acquired`);
    return result.rows[0]?.acquired === true;
  }

  async release(key: string): Promise<void> {
    const result = await this.db.execute(sql`select pg_advisory_unlock(hashtext(${key})) as released`);
    if (result.rows[0]?.released !== true) {
      this.logger.warn(
        `pg_advisory_unlock reported advisory lock "${key}" was not held by this session — ` +
          `SQL_EXECUTOR is pooled or transaction-pooled, so tryAcquire() and release() ran on ` +
          `different connections. The lock stays held on the acquiring connection until it closes, ` +
          `and this job will skip runs until then. Give SQL_EXECUTOR a dedicated single connection ` +
          `and never a transaction-mode pooler. See background-jobs/README.md.`,
      );
    }
  }
}
