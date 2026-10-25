import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DedupeClaim, NotificationDeduplicator, NotificationResult } from '../../notification.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR } from '../tokens';

/**
 * `NotificationDeduplicator` for Postgres. `claim` is one atomic statement: insert the key, or take over a row whose
 * window has passed — exactly one of two concurrent callers gets `claimed`. The loser reads the row: the first call's
 * result, or NULL while it's still sending.
 */
@Injectable()
export class PostgresNotificationDeduplicator implements NotificationDeduplicator {
  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
  ) {}

  async claim(key: string, windowMs: number): Promise<DedupeClaim> {
    const { rows } = await this.db.execute(sql`
      insert into commons_notification_dedupe as d (application, dedupe_key, claimed_at, expires_at)
      values (${this.application}, ${key}, now(), now() + ${Math.round(windowMs)} * interval '1 millisecond')
      on conflict (application, dedupe_key) do update set
        claimed_at = excluded.claimed_at, expires_at = excluded.expires_at, result = null
        where d.expires_at < now()
      returning dedupe_key
    `);
    if (rows.length > 0) return { claimed: true };
    const prior = await this.db.execute<{ result: NotificationResult | null }>(sql`
      select result from commons_notification_dedupe where application = ${this.application} and dedupe_key = ${key}
    `);
    return { claimed: false, prior: prior.rows[0]?.result ?? null };
  }

  async complete(key: string, result: NotificationResult): Promise<void> {
    await this.db.execute(sql`
      update commons_notification_dedupe set result = ${JSON.stringify(result)}::jsonb
      where application = ${this.application} and dedupe_key = ${key}
    `);
  }
}
