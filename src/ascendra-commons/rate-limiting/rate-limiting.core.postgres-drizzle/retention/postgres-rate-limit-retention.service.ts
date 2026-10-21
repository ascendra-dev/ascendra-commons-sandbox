import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SqlExecutor } from '../persistence/sql-executor';
import { RATE_LIMIT_APPLICATION_ID, RATE_LIMIT_SQL_EXECUTOR } from '../tokens';

const DEFAULT_BATCH_SIZE = 5_000;

/**
 * Keeps `commons_rate_limit_rejection` from growing forever. The adapter never
 * runs it on its own — retention is consumer-owned (MODULE-STANDARD.md
 * dimension 7): call `pruneRejections()` from whatever scheduler the project
 * has (a `background-jobs` `ScheduledJob`, a cron), with its own cutoff.
 *
 * Deletes in batches so a large backlog never holds one long lock on a table
 * the throttler is writing to. `application`-qualified — in a shared database it
 * never touches another app's rows.
 */
@Injectable()
export class PostgresRateLimitRetentionService {
  constructor(
    @Inject(RATE_LIMIT_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(RATE_LIMIT_APPLICATION_ID) private readonly application: string,
  ) {}

  /** Deletes this application's rejection windows that started before `before`. Returns how many rows went. */
  async pruneRejections(before: Date, batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    let total = 0;
    for (;;) {
      const { rows } = await this.db.execute(sql`
        with doomed as (
          select id from commons_rate_limit_rejection
          where application = ${this.application} and window_start < ${before}
          limit ${batchSize}
        )
        delete from commons_rate_limit_rejection where id in (select id from doomed)
        returning id
      `);
      total += rows.length;
      if (rows.length < batchSize) return total;
    }
  }
}
