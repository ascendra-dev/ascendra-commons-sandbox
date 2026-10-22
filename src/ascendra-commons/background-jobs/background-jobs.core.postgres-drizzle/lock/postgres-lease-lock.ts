import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AdvisoryLock } from '../../background-jobs.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { LEASE_LOCK_APPLICATION_ID, LEASE_LOCK_SECONDS, LEASE_LOCK_SQL_EXECUTOR } from '../tokens';

/**
 * A distributed lock backed by a `commons_jobs_lock` row instead of a Postgres
 * session-level advisory lock. The lock is a *row*, so:
 *
 *   - `tryAcquire` and `release` can run on any pooled connection — no
 *     dedicated-connection requirement, and it works through a transaction-mode
 *     pooler (PgBouncer / Supabase "Transaction pooler"), where the core's
 *     `PostgresAdvisoryLock` does not.
 *   - Crash safety comes from the `locked_until` lease, not from a connection
 *     closing: a holder that dies without releasing lets the row expire, and
 *     the next `tryAcquire` reclaims it.
 *
 * While a run holds the lock, this class renews `locked_until` on a heartbeat
 * (every `leaseSeconds / 3`), so a run legitimately longer than one lease keeps
 * the lock. If the heartbeat ever finds the row gone (the lease lapsed and
 * another instance took over), it logs a WARN — the signal to raise
 * `leaseSeconds`.
 *
 * Implements the same `AdvisoryLock` port as `PostgresAdvisoryLock`; swapping is
 * a one-line `forRoot` change plus one migration. See the adapter README.
 */
@Injectable()
export class PostgresLeaseLock implements AdvisoryLock, OnModuleDestroy {
  private readonly logger = new Logger(PostgresLeaseLock.name);
  /** Unique per process — release/heartbeat only ever touch this process's own lease, never another holder's. */
  private readonly holder = `${hostname()}#${process.pid}#${randomUUID().slice(0, 8)}`;
  private readonly heartbeats = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    @Inject(LEASE_LOCK_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(LEASE_LOCK_APPLICATION_ID) private readonly application: string,
    @Inject(LEASE_LOCK_SECONDS) private readonly leaseSeconds: number,
  ) {}

  async tryAcquire(key: string): Promise<boolean> {
    // Conditional upsert: INSERT if the key is free; take over on conflict ONLY if the
    // existing lease has expired. Postgres re-checks the WHERE against the row-locked
    // tuple, so two instances racing an expired lock — one wins, the other sees the
    // freshly-extended locked_until and gets 0 rows.
    const result = await this.db.execute(sql`
      insert into commons_jobs_lock (application, lock_key, holder, acquired_at, locked_until)
      values (${this.application}, ${key}, ${this.holder}, now(), now() + (${this.leaseSeconds} * interval '1 second'))
      on conflict (application, lock_key) do update
        set holder = excluded.holder, acquired_at = now(), locked_until = excluded.locked_until
        where commons_jobs_lock.locked_until < now()
      returning holder
    `);

    const acquired = result.rows[0]?.holder === this.holder;
    if (acquired) this.startHeartbeat(key);
    return acquired;
  }

  async release(key: string): Promise<void> {
    this.stopHeartbeat(key);
    const result = await this.db.execute(sql`
      delete from commons_jobs_lock
      where application = ${this.application} and lock_key = ${key} and holder = ${this.holder}
      returning lock_key
    `);
    if (result.rows.length === 0) {
      this.logger.debug(
        `Lease lock "${key}" was not held by this process at release — it had expired and likely been taken over. If this recurs, the job is overrunning its ${this.leaseSeconds}s lease.`,
      );
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.heartbeats.values()) clearInterval(timer);
    this.heartbeats.clear();
  }

  private startHeartbeat(key: string): void {
    this.stopHeartbeat(key);
    const intervalMs = Math.max(1000, Math.floor((this.leaseSeconds * 1000) / 3));
    const timer = setInterval(() => {
      void this.beat(key);
    }, intervalMs);
    timer.unref?.();
    this.heartbeats.set(key, timer);
  }

  private stopHeartbeat(key: string): void {
    const timer = this.heartbeats.get(key);
    if (timer) {
      clearInterval(timer);
      this.heartbeats.delete(key);
    }
  }

  private async beat(key: string): Promise<void> {
    try {
      const result = await this.db.execute(sql`
        update commons_jobs_lock
        set locked_until = now() + (${this.leaseSeconds} * interval '1 second')
        where application = ${this.application} and lock_key = ${key} and holder = ${this.holder}
        returning lock_key
      `);
      if (result.rows.length === 0) {
        this.logger.warn(
          `Lease lock "${key}" heartbeat found no row held by this process — the ${this.leaseSeconds}s lease lapsed and another instance may now be running this job concurrently. Raise leaseSeconds if the job legitimately runs this long.`,
        );
        this.stopHeartbeat(key);
      }
    } catch (err) {
      this.logger.warn(
        `Lease lock "${key}" heartbeat failed (retrying next interval): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
