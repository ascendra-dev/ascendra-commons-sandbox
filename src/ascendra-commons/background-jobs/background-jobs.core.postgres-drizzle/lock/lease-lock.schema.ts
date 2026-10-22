import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_jobs_lock` table — one row per held (or recently held)
 * job lock, for `PostgresLeaseLock`. A distributed mutex as a *row*, not a
 * connection: any pooled connection can claim, renew, or release it, and it
 * works through a transaction-mode pooler — unlike the session-level
 * `pg_advisory_lock` the core's `PostgresAdvisoryLock` uses.
 *
 * Source of truth for the reference schema — change it together with
 * `postgres-lease-lock.ts`'s statements, and ship the change as the next
 * numbered file in `../migrations/` (never an edit to a released one).
 *
 * `locked_until` is the lease: a holder that crashes without releasing simply
 * lets the row expire, and the next run claims it. The holder renews
 * `locked_until` on a heartbeat while its run is in progress.
 *
 * `application` scopes the lock the same way it scopes `commons_jobs_job_run` — two
 * Ascendra apps sharing one database don't contend on a same-named job's lock.
 */
export const leaseLockTable = pgTable(
  'commons_jobs_lock',
  {
    application: text('application').notNull(),
    /** The lock key as `IdempotentJobRunner` forms it, e.g. `scheduler:invoice-reminder`. */
    lockKey: text('lock_key').notNull(),
    /** Unique per holding process — release and heartbeat only ever touch this process's own lease. */
    holder: text('holder').notNull(),
    acquiredAt: timestamp('acquired_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.application, t.lockKey] })],
);
