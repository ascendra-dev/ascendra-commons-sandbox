import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NotificationChannel, NotificationConfig, NotificationTemplate, ProviderConfig } from '../../notification.core';
import { ConfigCache } from '../../notification.core.database';
import type { SqlExecutor } from '../persistence/sql-executor';
import { NOTIFICATION_CONFIG_OPTIONS, NOTIFICATION_CONFIG_SQL_EXECUTOR } from '../tokens';

export interface NotificationConfigOptions {
  /** Which Ascendra app this process is — written on every row, filtered on every read. */
  application: string;
  /** Config-cache TTL. `0` disables the cache. */
  cacheTtlSeconds: number;
  /** A tenant with no credential of its own sends through the platform's (`tenant_id` NULL row). */
  tenantCredentialFallback?: boolean;
}

/**
 * The database-backed `NotificationConfig` (Model 2) for Postgres/Drizzle.
 *
 * `channelsFor` / `templateFor` resolve a **tenant-specific row first**,
 * falling through to the deployment default (`tenant_id IS NULL`).
 * `providerConfigFor` reads the tenant's own account; a tenantless send reads the platform's (`tenant_id` NULL); a
 * tenant without one falls through to the platform's **only** with `tenantCredentialFallback`. Every read is scoped by
 * `application` and goes through the stack-agnostic `ConfigCache` (from
 * `notification.core.database`).
 *
 * Corresponding tables: `persistence/config.schema.ts` (DDL: `migrations/`).
 */
@Injectable()
export class PostgresNotificationConfig implements NotificationConfig {
  private readonly cache: ConfigCache;
  private readonly application: string;
  private readonly tenantCredentialFallback: boolean;

  constructor(
    @Inject(NOTIFICATION_CONFIG_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_CONFIG_OPTIONS) options: NotificationConfigOptions,
  ) {
    this.application = options.application;
    this.tenantCredentialFallback = options.tenantCredentialFallback ?? false;
    this.cache = new ConfigCache(options.cacheTtlSeconds * 1000);
  }

  channelsFor(notificationType: string, tenantId: string | null): Promise<NotificationChannel[]> {
    return this.cache.get(`route:${notificationType}:${tenantId ?? ''}`, async () => {
      const { rows } = await this.db.execute<{ channels: string[] }>(sql`
        SELECT channels FROM commons_notification_channel_route
        WHERE application = ${this.application} AND notification_type = ${notificationType}
          AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
        ORDER BY tenant_id IS NULL
        LIMIT 1
      `);
      return (rows[0]?.channels ?? []) as NotificationChannel[];
    });
  }

  templateFor(
    channel: NotificationChannel,
    notificationType: string,
    tenantId: string | null,
  ): Promise<NotificationTemplate | null> {
    return this.cache.get(`tpl:${channel}:${notificationType}:${tenantId ?? ''}`, async () => {
      const { rows } = await this.db.execute<{ subject: string | null; body: string; is_html: boolean }>(sql`
        SELECT subject, body, is_html FROM commons_notification_template
        WHERE application = ${this.application} AND channel = ${channel} AND notification_type = ${notificationType}
          AND (tenant_id = ${tenantId} OR tenant_id IS NULL)
        ORDER BY tenant_id IS NULL
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) return null;
      return { subject: row.subject ?? undefined, body: row.body, isHtml: row.is_html };
    });
  }

  providerConfigFor(channel: NotificationChannel, tenantId: string | null): Promise<ProviderConfig | null> {
    return this.cache.get(`cred:${channel}:${tenantId ?? ''}`, async () => {
      // The tenant's own account; the platform's (tenant_id NULL) for a tenantless send, or as the fallback — the
      // tenant's own row first. Never another tenant's.
      const whose =
        tenantId === null
          ? sql`tenant_id IS NULL`
          : this.tenantCredentialFallback
            ? sql`(tenant_id = ${tenantId} OR tenant_id IS NULL)`
            : sql`tenant_id = ${tenantId}`;
      const { rows } = await this.db.execute<{ config: Record<string, unknown> }>(sql`
        SELECT config FROM commons_notification_provider_credential
        WHERE application = ${this.application} AND channel = ${channel} AND ${whose}
        ORDER BY tenant_id IS NULL
        LIMIT 1
      `);
      return rows[0]?.config ?? null; // returned verbatim — opaque to this library
    });
  }
}
