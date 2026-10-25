import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SqlExecutor } from '../persistence/sql-executor';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR } from '../tokens';

const DEFAULT_BATCH_SIZE = 5_000;

/**
 * Keeps `commons_notification_delivery` from growing forever — and its personal data from staying longer than the
 * rest. Two cutoffs, because they protect different things:
 *
 * - `clearContent(before)` empties the stored rendered message (`content` — names, amounts, addresses) of rows older
 *   than `before`, keeping the row: "it went out, and when" outlives "what it said". A shorter cutoff (30 days).
 * - `pruneDeliveries(before)` deletes rows older than `before` (90 days).
 *
 * The adapter never runs it on its own — retention is consumer-owned (MODULE-STANDARD.md dimension 7): call both
 * from whatever scheduler the project has (a `background-jobs` `ScheduledJob`, a cron), with its own cutoffs. Works
 * in batches so a backlog never holds one long lock on the table the recorder writes. `application`-qualified — in a
 * shared database it never touches another app's rows.
 */
@Injectable()
export class PostgresNotificationRetentionService {
  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
  ) {}

  /** Empties the stored content of this application's deliveries attempted before `before`. Returns how many rows. */
  async clearContent(before: Date, batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    return this.inBatches(batchSize, (limit) => sql`
      with doomed as (
        select id from commons_notification_delivery
        where application = ${this.application} and attempted_at < ${before} and content is not null
        limit ${limit}
      )
      update commons_notification_delivery set content = null where id in (select id from doomed)
      returning id
    `);
  }

  /** Deletes this application's deliveries attempted before `before`. Returns how many rows went. */
  async pruneDeliveries(before: Date, batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    return this.inBatches(batchSize, (limit) => sql`
      with doomed as (
        select id from commons_notification_delivery
        where application = ${this.application} and attempted_at < ${before}
        limit ${limit}
      )
      delete from commons_notification_delivery where id in (select id from doomed)
      returning id
    `);
  }

  /** Deletes this application's dedupe keys whose window has passed — they no longer stop a send. */
  async pruneDedupeKeys(now: Date = new Date(), batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    return this.inBatches(batchSize, (limit) => sql`
      with doomed as (
        select dedupe_key from commons_notification_dedupe
        where application = ${this.application} and expires_at < ${now}
        limit ${limit}
      )
      delete from commons_notification_dedupe
      where application = ${this.application} and dedupe_key in (select dedupe_key from doomed)
      returning dedupe_key
    `);
  }

  /** Deletes this application's in-app inbox items created before `before`, read or not. */
  async pruneInbox(before: Date, batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    return this.inBatches(batchSize, (limit) => sql`
      with doomed as (
        select id from commons_notification_inbox
        where application = ${this.application} and created_at < ${before}
        limit ${limit}
      )
      delete from commons_notification_inbox where id in (select id from doomed)
      returning id
    `);
  }

  private async inBatches(batchSize: number, statement: (limit: number) => ReturnType<typeof sql>): Promise<number> {
    const limit = Math.max(1, Math.floor(batchSize));
    let total = 0;
    for (;;) {
      const { rows } = await this.db.execute(statement(limit));
      total += rows.length;
      if (rows.length < limit) return total;
    }
  }
}
