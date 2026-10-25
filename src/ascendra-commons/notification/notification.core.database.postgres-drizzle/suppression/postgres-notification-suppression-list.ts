import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NotificationChannel, NotificationSuppressionList } from '../../notification.core';
import { ConfigCache } from '../../notification.core.database';
import type { SqlExecutor } from '../persistence/sql-executor';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR, NOTIFICATION_SUPPRESSION_OPTIONS } from '../tokens';

export interface PostgresNotificationSuppressionListOptions {
  /** How long a lookup is cached. Default 30 s; `0` disables. Removing an entry through the admin API clears it. */
  cacheTtlSeconds?: number;
}

/**
 * The `NotificationSuppressionList` Notifier asks before each channel's send — one indexed lookup on the unique key,
 * cached (suppressions are rare and change rarely; a batch to the same recipients doesn't query each time). A new
 * suppression is seen within the TTL; one removed through the admin API at once in this process
 * (`ConfigCache.invalidateAll`).
 */
@Injectable()
export class PostgresNotificationSuppressionList implements NotificationSuppressionList {
  private readonly cache: ConfigCache;

  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
    @Inject(NOTIFICATION_SUPPRESSION_OPTIONS) options: PostgresNotificationSuppressionListOptions,
  ) {
    this.cache = new ConfigCache((options.cacheTtlSeconds ?? 30) * 1000, 10_000);
  }

  isSuppressed(channel: NotificationChannel, recipientKey: string): Promise<boolean> {
    return this.cache.get(`sup:${channel}:${recipientKey}`, async () => {
      const { rows } = await this.db.execute(sql`
        select 1 from commons_notification_suppression
        where application = ${this.application} and channel = ${channel} and recipient_key = ${recipientKey}
      `);
      return rows.length > 0;
    });
  }
}
