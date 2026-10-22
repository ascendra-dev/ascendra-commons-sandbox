import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SqlExecutor } from '../persistence/sql-executor';
import { EVENT_DELIVERY_APPLICATION_ID, EVENT_DELIVERY_SQL_EXECUTOR } from '../tokens';

const DEFAULT_BATCH_SIZE = 5_000;

/**
 * Keeps `commons_domain_events_delivery` from growing forever. The adapter never
 * runs it on its own — retention is consumer-owned (MODULE-STANDARD.md
 * dimension 7): call `pruneDeliveries()` from whatever scheduler the project
 * has (a `background-jobs` `ScheduledJob`, a cron), with its own cutoff.
 *
 * Deletes in batches so a large backlog never holds one long lock on a table
 * every emit's recorder is writing to. `application`-qualified — in a shared database it
 * never touches another app's rows.
 */
@Injectable()
export class PostgresEventDeliveryRetentionService {
  constructor(
    @Inject(EVENT_DELIVERY_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(EVENT_DELIVERY_APPLICATION_ID) private readonly application: string,
  ) {}

  /** Deletes this application's deliveries whose event occurred before `before`. Returns how many rows went. */
  async pruneDeliveries(before: Date, batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    let total = 0;
    for (;;) {
      const { rows } = await this.db.execute(sql`
        with doomed as (
          select id from commons_domain_events_delivery
          where application = ${this.application} and occurred_at < ${before}
          limit ${batchSize}
        )
        delete from commons_domain_events_delivery where id in (select id from doomed)
        returning id
      `);
      total += rows.length;
      if (rows.length < batchSize) return total;
    }
  }
}
