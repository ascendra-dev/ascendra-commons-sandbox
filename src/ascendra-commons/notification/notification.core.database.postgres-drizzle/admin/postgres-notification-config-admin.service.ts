import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { NotificationChannel } from '../../notification.core';
import {
  ConfigCache,
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidDeliveryCursorError,
  isDeliveryId,
} from '../../notification.core.database';
import type {
  ChannelRouteView,
  ConfigScope,
  DeleteChannelRouteInput,
  DeleteProviderCredentialInput,
  DeleteTemplateInput,
  NotificationConfigAdminPort,
  ProviderCredentialView,
  SetChannelRouteInput,
  SetProviderCredentialInput,
  SetTemplateInput,
  SuppressionListQuery,
  SuppressionPage,
  SuppressionView,
  TemplateView,
} from '../../notification.core.database';
import type { SqlExecutor } from '../persistence/sql-executor';
import { textArray } from '../persistence/sql-helpers';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR } from '../tokens';

/**
 * `NotificationConfigAdminPort` for Postgres/Drizzle — CRUD on the three
 * `commons_notification_*` config tables. Every write is one upsert or delete,
 * `application`-stamped, on the table's own unique key (`tenant_id` NULL = the
 * deployment default). Requires PostgreSQL 15+ (`NULLS NOT DISTINCT`).
 *
 * Every write empties the process's config caches (`ConfigCache.invalidateAll`), so the next send uses it.
 *
 * Provider-credential *values* are never returned by `listProviderCredentials`.
 * Audit + actor-scoping are `notification.api`'s.
 */
@Injectable()
export class PostgresNotificationConfigAdminService implements NotificationConfigAdminPort {
  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
  ) {}

  async getChannelRoute(notificationType: string, tenantId: string | null): Promise<ChannelRouteView | null> {
    const { rows } = await this.db.execute<{ notification_type: string; tenant_id: string | null; channels: string[] }>(sql`
      select notification_type, tenant_id, channels from commons_notification_channel_route
      where application = ${this.application} and notification_type = ${notificationType} and ${tenantCond(tenantId)}
    `);
    const r = rows[0];
    return r ? { notificationType: r.notification_type, tenantId: r.tenant_id, channels: r.channels as NotificationChannel[] } : null;
  }

  async setChannelRoute(input: SetChannelRouteInput): Promise<void> {
    await this.db.execute(sql`
      insert into commons_notification_channel_route (application, notification_type, tenant_id, channels)
      values (${this.application}, ${input.notificationType}, ${input.tenantId}, ${textArray(input.channels)})
      on conflict on constraint commons_notification_channel_route_uq
      do update set channels = excluded.channels
    `);
    ConfigCache.invalidateAll();
  }

  async deleteChannelRoute(input: DeleteChannelRouteInput): Promise<void> {
    await this.db.execute(sql`
      delete from commons_notification_channel_route
      where application = ${this.application} and notification_type = ${input.notificationType}
        and ${tenantCond(input.tenantId)}
    `);
    ConfigCache.invalidateAll();
  }

  async listChannelRoutes(scope?: ConfigScope): Promise<ChannelRouteView[]> {
    const { rows } = await this.db.execute<{ notification_type: string; tenant_id: string | null; channels: string[] }>(sql`
      select notification_type, tenant_id, channels from commons_notification_channel_route
      where application = ${this.application} and ${defaultsAnd(scope)}
      order by notification_type, tenant_id nulls first
    `);
    return rows.map((r) => ({
      notificationType: r.notification_type,
      tenantId: r.tenant_id,
      channels: r.channels as NotificationChannel[],
    }));
  }

  async getTemplate(channel: NotificationChannel, notificationType: string, tenantId: string | null): Promise<TemplateView | null> {
    const { rows } = await this.db.execute<{
      channel: string;
      notification_type: string;
      tenant_id: string | null;
      subject: string | null;
      body: string;
      is_html: boolean;
    }>(sql`
      select channel, notification_type, tenant_id, subject, body, is_html from commons_notification_template
      where application = ${this.application} and channel = ${channel} and notification_type = ${notificationType}
        and ${tenantCond(tenantId)}
    `);
    const r = rows[0];
    return r
      ? { channel: r.channel as NotificationChannel, notificationType: r.notification_type, tenantId: r.tenant_id, subject: r.subject, body: r.body, isHtml: r.is_html }
      : null;
  }

  async setTemplate(input: SetTemplateInput): Promise<void> {
    await this.db.execute(sql`
      insert into commons_notification_template
        (application, channel, notification_type, tenant_id, subject, body, is_html)
      values (
        ${this.application}, ${input.channel}, ${input.notificationType}, ${input.tenantId},
        ${input.subject ?? null}, ${input.body}, ${input.isHtml ?? false}
      )
      on conflict on constraint commons_notification_template_uq
      do update set subject = excluded.subject, body = excluded.body, is_html = excluded.is_html
    `);
    ConfigCache.invalidateAll();
  }

  async deleteTemplate(input: DeleteTemplateInput): Promise<void> {
    await this.db.execute(sql`
      delete from commons_notification_template
      where application = ${this.application} and channel = ${input.channel}
        and notification_type = ${input.notificationType} and ${tenantCond(input.tenantId)}
    `);
    ConfigCache.invalidateAll();
  }

  async listTemplates(scope?: ConfigScope): Promise<TemplateView[]> {
    const { rows } = await this.db.execute<{
      channel: string;
      notification_type: string;
      tenant_id: string | null;
      subject: string | null;
      body: string;
      is_html: boolean;
    }>(sql`
      select channel, notification_type, tenant_id, subject, body, is_html
      from commons_notification_template
      where application = ${this.application} and ${defaultsAnd(scope)}
      order by notification_type, channel, tenant_id nulls first
    `);
    return rows.map((r) => ({
      channel: r.channel as NotificationChannel,
      notificationType: r.notification_type,
      tenantId: r.tenant_id,
      subject: r.subject,
      body: r.body,
      isHtml: r.is_html,
    }));
  }

  async hasProviderCredential(channel: NotificationChannel, tenantId: string | null): Promise<boolean> {
    // The value stays in the table — only whether a row exists.
    const { rows } = await this.db.execute(sql`
      select 1 from commons_notification_provider_credential
      where application = ${this.application} and channel = ${channel} and ${tenantCond(tenantId)}
    `);
    return rows.length > 0;
  }

  async setProviderCredential(input: SetProviderCredentialInput): Promise<void> {
    await this.db.execute(sql`
      insert into commons_notification_provider_credential (application, channel, tenant_id, config)
      values (${this.application}, ${input.channel}, ${input.tenantId}, ${JSON.stringify(input.config)}::jsonb)
      on conflict on constraint commons_notification_provider_credential_uq
      do update set config = excluded.config
    `);
    ConfigCache.invalidateAll();
  }

  async deleteProviderCredential(input: DeleteProviderCredentialInput): Promise<void> {
    await this.db.execute(sql`
      delete from commons_notification_provider_credential
      where application = ${this.application} and channel = ${input.channel} and ${tenantCond(input.tenantId)}
    `);
    ConfigCache.invalidateAll();
  }

  async listProviderCredentials(scope?: ConfigScope): Promise<ProviderCredentialView[]> {
    // A tenant admin sees their own and the platform's — whether there's an account to fall back to.
    const { rows } = await this.db.execute<{ channel: string; tenant_id: string | null }>(sql`
      select channel, tenant_id from commons_notification_provider_credential
      where application = ${this.application} and ${defaultsAnd(scope)}
      order by channel, tenant_id nulls first
    `);
    return rows.map((r) => ({ channel: r.channel as NotificationChannel, tenantId: r.tenant_id }));
  }

  async listSuppressions(query: SuppressionListQuery, scope?: ConfigScope): Promise<SuppressionPage> {
    const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
    const conds = [sql`s.application = ${this.application}`];
    if (scope) conds.push(affects(scope.tenantId));
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor);
      if (!cursor) throw new InvalidDeliveryCursorError(`Unrecognized cursor "${query.cursor}"`);
      const ts = sql`${cursor.timestamp}::timestamptz`;
      conds.push(sql`s.last_at <= ${ts} and (s.last_at < ${ts} or s.id < ${cursor.id}::bigint)`);
    }
    const { rows } = await this.db.execute<SuppressionRow & { last_at_key: string }>(sql`
      select s.id, s.channel, s.recipient_key, s.tenant_id, s.reason, s.detail, s.first_at, s.last_at, s.event_count,
             to_char(s.last_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as last_at_key
      from commons_notification_suppression s
      where ${sql.join(conds, sql` and `)}
      order by s.last_at desc, s.id desc
      limit ${limit + 1}
    `);
    if (rows.length > limit) {
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { suppressions: page.map(toSuppression), nextCursor: encodeKeysetCursor(String(last.last_at_key), String(last.id)) };
    }
    return { suppressions: rows.map(toSuppression) };
  }

  async getSuppression(id: string, scope?: ConfigScope): Promise<SuppressionView | null> {
    if (!isDeliveryId(id)) return null;
    const { rows } = await this.db.execute<SuppressionRow>(sql`
      select s.id, s.channel, s.recipient_key, s.tenant_id, s.reason, s.detail, s.first_at, s.last_at, s.event_count
      from commons_notification_suppression s
      where s.application = ${this.application} and s.id = ${id}::bigint and ${scope ? affects(scope.tenantId) : sql`true`}
    `);
    return rows[0] ? toSuppression(rows[0]) : null;
  }

  async deleteSuppression(id: string): Promise<void> {
    if (!isDeliveryId(id)) return;
    await this.db.execute(sql`
      delete from commons_notification_suppression where application = ${this.application} and id = ${id}::bigint
    `);
    // The suppression list caches its lookups — the recipient is sent to again at once in this process.
    ConfigCache.invalidateAll();
  }
}

interface SuppressionRow {
  id: string | number;
  channel: string;
  recipient_key: string;
  tenant_id: string | null;
  reason: string;
  detail: string | null;
  first_at: string | Date;
  last_at: string | Date;
  event_count: string | number;
}

function toSuppression(r: SuppressionRow): SuppressionView {
  const asDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));
  return {
    id: String(r.id),
    channel: r.channel as NotificationChannel,
    recipientKey: r.recipient_key,
    tenantId: r.tenant_id,
    reason: r.reason,
    detail: r.detail,
    firstAt: asDate(r.first_at),
    lastAt: asDate(r.last_at),
    eventCount: Number(r.event_count),
  };
}

/**
 * A suppression (alias `s`) a tenant is affected by: filed under it, or for a recipient it has sent to on that channel
 * — every send of its to them is skipped too. On the delivery log's recipient-key index.
 */
function affects(tenantId: string) {
  return sql`(s.tenant_id = ${tenantId} or exists (
    select 1 from commons_notification_delivery d
    where d.application = s.application and d.recipient_key = s.recipient_key and d.channel = s.channel and d.tenant_id = ${tenantId}
  ))`;
}

/** The deployment defaults plus one tenant's rows — or every row when unscoped. */
function defaultsAnd(scope?: ConfigScope) {
  return scope ? sql`(tenant_id is null or tenant_id = ${scope.tenantId})` : sql`true`;
}

function tenantCond(tenantId: string | null) {
  return tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${tenantId}`;
}
