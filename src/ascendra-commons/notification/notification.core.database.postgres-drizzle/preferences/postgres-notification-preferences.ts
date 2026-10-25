import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NotificationChannel, NotificationPreferences } from '../../notification.core';
import { ConfigCache, preferenceAllows, type NotificationPreferenceStore, type PreferenceRule } from '../../notification.core.database';
import type { SqlExecutor } from '../persistence/sql-executor';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR } from '../tokens';

/** A user's rules for a while — read once per user on a batch, not once per send; cleared when one changes. */
const CACHE_TTL_MS = 30_000;

/**
 * A user's notification preferences for Postgres: the `NotificationPreferences` Notifier asks on each send to a user,
 * and the `NotificationPreferenceStore` "my preferences" reads and edits. A user's rules are read together and cached;
 * the most specific rule matching (type, channel) wins — (type, channel) › (type, *) › (*, channel) › (*, *) — and
 * with none, the notification is sent.
 */
@Injectable()
export class PostgresNotificationPreferences implements NotificationPreferences, NotificationPreferenceStore {
  private readonly cache = new ConfigCache(CACHE_TTL_MS, 10_000);

  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
  ) {}

  async isOptedOut(userId: string, notificationType: string, channel: NotificationChannel): Promise<boolean> {
    const rules = await this.cache.get(`pref:${userId}`, () => this.listRules(userId));
    return !preferenceAllows(rules, notificationType, channel);
  }

  async listRules(userId: string): Promise<PreferenceRule[]> {
    const { rows } = await this.db.execute<{ notification_type: string; channel: string; enabled: boolean; updated_at: string | Date }>(sql`
      select notification_type, channel, enabled, updated_at from commons_notification_preference
      where application = ${this.application} and user_id = ${userId}
      order by notification_type, channel
    `);
    return rows.map((r) => ({
      notificationType: r.notification_type,
      channel: r.channel as PreferenceRule['channel'],
      enabled: r.enabled,
      updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at),
    }));
  }

  async setRule(userId: string, rule: Omit<PreferenceRule, 'updatedAt'>): Promise<void> {
    await this.db.execute(sql`
      insert into commons_notification_preference (application, user_id, notification_type, channel, enabled)
      values (${this.application}, ${userId}, ${rule.notificationType}, ${rule.channel}, ${rule.enabled})
      on conflict (application, user_id, notification_type, channel) do update set enabled = excluded.enabled, updated_at = now()
    `);
    // The next send to this user — in this process — reads the new rule.
    ConfigCache.invalidateAll();
  }
}
