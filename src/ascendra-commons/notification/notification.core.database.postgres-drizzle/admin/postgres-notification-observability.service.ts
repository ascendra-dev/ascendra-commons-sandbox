import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { DeliveryContent, NotificationChannel } from '../../notification.core';
import {
  calendarDays,
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidDeliveryCursorError,
  isDeliveryId,
  type ConfigScope,
  type CoverageGap,
  type DeliveryContentRecord,
  type DeliveryHistoryPage,
  type DeliveryHistoryQuery,
  type DeliveryRecord,
  type DeliveryStats,
  type DeliveryStatsQuery,
  type DeliveryReasonCount,
  type DeliveryVolume,
  type NotificationObservabilityPort,
} from '../../notification.core.database';
import type { SqlExecutor } from '../persistence/sql-executor';
import {
  NOTIFICATION_ADMIN_APPLICATION_ID,
  NOTIFICATION_ADMIN_CREDENTIAL_FALLBACK,
  NOTIFICATION_ADMIN_SQL_EXECUTOR,
} from '../tokens';

/** The Volume & Retention chart's span. */
const VOLUME_DAYS = 30;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** `attempted_at` at the column's own precision (microseconds), for the keyset cursor — a JS `Date` keeps milliseconds. */
const ATTEMPTED_AT_KEY = sql`to_char(attempted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as attempted_at_key`;
/** The latest retry of row `d` — an index probe per row (`commons_notification_delivery_retry_of_idx`). */
const RETRIED_BY = sql`(select r.id from commons_notification_delivery r
  where r.application = d.application and r.retry_of = d.id order by r.id desc limit 1) as retried_by`;

/**
 * `NotificationObservabilityPort` for Postgres/Drizzle — the delivery log
 * (`getDeliveryHistory` / `getDeliveryContent`) and gaps in the
 * routing/template/credential config (`configCoverageGaps`). Everything
 * `application`-scoped. No write path.
 */
@Injectable()
export class PostgresNotificationObservabilityService implements NotificationObservabilityPort {
  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
    @Optional() @Inject(NOTIFICATION_ADMIN_CREDENTIAL_FALLBACK) private readonly tenantCredentialFallback = false,
  ) {}

  async getDeliveryHistory(query: DeliveryHistoryQuery = {}): Promise<DeliveryHistoryPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.notificationType !== undefined) conds.push(sql`notification_type = ${query.notificationType}`);
    if (query.channel !== undefined) conds.push(sql`channel = ${query.channel}`);
    if (query.tenantId !== undefined) conds.push(sql`tenant_id = ${query.tenantId}`);
    if (query.recipientRef !== undefined) conds.push(sql`recipient_ref = ${query.recipientRef}`);
    if (query.recipientKey !== undefined) conds.push(sql`recipient_key = ${query.recipientKey}`);
    if (query.status !== undefined) conds.push(sql`status = ${query.status}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.reason !== undefined) conds.push(sql`(reason = ${query.reason} or starts_with(reason, ${`${query.reason}:`}))`);
    if (query.test !== undefined) conds.push(sql`is_test = ${query.test}`);
    if (query.since) conds.push(sql`attempted_at >= ${query.since}`);
    if (query.until) conds.push(sql`attempted_at < ${query.until}`);

    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor);
      // A cursor that doesn't decode was never issued here — silently starting from the top would repeat page one.
      if (!cursor) throw new InvalidDeliveryCursorError(`Unrecognized cursor "${query.cursor}"`);
      const ts = sql`${cursor.timestamp}::timestamptz`;
      // Leads with the indexed column, so the index range starts at the cursor — the OR alone is a Filter, scanned
      // from the top on every page.
      conds.push(sql`attempted_at <= ${ts} and (attempted_at < ${ts} or id < ${cursor.id}::bigint)`);
    }

    const rows = (
      await this.db.execute<DeliveryRow & { attempted_at_key: string }>(sql`
        select id, notification_type, channel, tenant_id, recipient_ref, recipient_key, status, reason,
               provider_message_id, attempted_at, updated_at, correlation_id,
               (content is not null) as has_content, is_test, retry_of, ${RETRIED_BY}, ${ATTEMPTED_AT_KEY}
        from commons_notification_delivery d
        where ${sql.join(conds, sql` and `)}
        order by attempted_at desc, id desc
        limit ${limit + 1}
      `)
    ).rows;

    if (rows.length > limit) {
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { deliveries: page.map(mapRow), nextCursor: encodeKeysetCursor(String(last.attempted_at_key), String(last.id)) };
    }
    return { deliveries: rows.map(mapRow) };
  }

  async getDelivery(id: string): Promise<DeliveryRecord | null> {
    // Not a delivery id can't name a row — and `::bigint` would fail the query.
    if (!isDeliveryId(id)) return null;
    const { rows } = await this.db.execute<DeliveryRow>(sql`
      select id, notification_type, channel, tenant_id, recipient_ref, recipient_key, status, reason,
             provider_message_id, attempted_at, updated_at, correlation_id,
             (content is not null) as has_content, is_test, retry_of, ${RETRIED_BY}
      from commons_notification_delivery d
      where application = ${this.application} and id = ${id}::bigint
    `);
    const row = rows[0];
    return row ? mapRow(row) : null;
  }

  async getDeliveryContent(id: string): Promise<DeliveryContentRecord | null> {
    if (!isDeliveryId(id)) return null;
    const { rows } = await this.db.execute<{
      id: string | number;
      notification_type: string;
      channel: string;
      recipient_ref: string;
      attempted_at: string | Date;
      content: DeliveryContent | null;
    }>(sql`
      select id, notification_type, channel, recipient_ref, attempted_at, content
      from commons_notification_delivery
      where application = ${this.application} and id = ${id}::bigint
    `);
    const row = rows[0];
    if (!row || row.content == null) return null;
    return {
      id: String(row.id),
      notificationType: row.notification_type,
      channel: row.channel as NotificationChannel,
      recipientRef: row.recipient_ref,
      attemptedAt: asDate(row.attempted_at),
      content: row.content,
    };
  }

  async configCoverageGaps(scope?: ConfigScope, tenants?: readonly string[]): Promise<CoverageGap[]> {
    // Scoped: the defaults plus one tenant's rows — a tenant admin's gaps, never another tenant's config.
    const rowsIn = scope ? sql`(tenant_id is null or tenant_id = ${scope.tenantId})` : sql`true`;
    const [routes, templates, creds] = await Promise.all([
      this.db.execute<{ notification_type: string; tenant_id: string | null; channels: string[] }>(
        sql`select notification_type, tenant_id, channels from commons_notification_channel_route where application = ${this.application} and ${rowsIn}`,
      ),
      this.db.execute<{ channel: string; notification_type: string; tenant_id: string | null }>(
        sql`select distinct channel, notification_type, tenant_id from commons_notification_template where application = ${this.application} and ${rowsIn}`,
      ),
      this.db.execute<{ channel: string; tenant_id: string | null }>(
        sql`select distinct channel, tenant_id from commons_notification_provider_credential where application = ${this.application} and ${rowsIn}`,
      ),
    ]);

    const templateKey = (c: string, nt: string, t: string | null) => `${c}|${nt}|${t ?? ''}`;
    const templateSet = new Set(templates.rows.map((r) => templateKey(r.channel, r.notification_type, r.tenant_id)));
    // WhatsApp's templates live on Meta's side — it needs no row here.
    const hasTemplate = (channel: string, nt: string, tenantId: string | null) =>
      channel === 'whatsapp' || templateSet.has(templateKey(channel, nt, tenantId)) || templateSet.has(templateKey(channel, nt, null));

    const credSet = new Set(creds.rows.map((r) => `${r.channel}|${r.tenant_id ?? ''}`));
    // With the fallback on, a tenant with no account of its own sends through the platform's — not a gap if it exists.
    // in_app needs none — the app is the provider.
    const hasCredential = (channel: string, tenantId: string) =>
      channel === 'in_app' || credSet.has(`${channel}|${tenantId}`) || (this.tenantCredentialFallback && credSet.has(`${channel}|`));

    const gaps: CoverageGap[] = [];
    const gap = (notificationType: string, tenantId: string | null, channel: string, kind: CoverageGap['kind']) =>
      gaps.push({ notificationType, tenantId, channel: channel as NotificationChannel, kind });

    for (const route of routes.rows) {
      for (const channel of route.channels) {
        if (!hasTemplate(channel, route.notification_type, route.tenant_id)) gap(route.notification_type, route.tenant_id, channel, 'missing_template');
        if (route.tenant_id !== null && !hasCredential(channel, route.tenant_id)) {
          gap(route.notification_type, route.tenant_id, channel, 'missing_provider_credential');
        }
      }
    }

    // A default route serves every tenant without a route of its own for that type — each needs an account on each of
    // its channels. (A missing default template is already reported once, for the default row.) Which tenants: the
    // scoped one; else the caller's list (the app's tenant directory); else every tenant the config names.
    const tenantIds = scope
      ? [scope.tenantId]
      : (tenants ?? [...new Set([...routes.rows, ...templates.rows, ...creds.rows].map((r) => r.tenant_id).filter((t): t is string => t !== null))]);
    const ownRoute = new Set(routes.rows.filter((r) => r.tenant_id !== null).map((r) => `${r.notification_type}|${r.tenant_id}`));
    for (const route of routes.rows.filter((r) => r.tenant_id === null)) {
      for (const tenantId of tenantIds) {
        if (ownRoute.has(`${route.notification_type}|${tenantId}`)) continue;
        for (const channel of route.channels) {
          if (!hasCredential(channel, tenantId)) gap(route.notification_type, tenantId, channel, 'missing_provider_credential');
        }
      }
    }
    return gaps;
  }

  async getDeliveryStats(query: DeliveryStatsQuery = {}, now: Date = new Date()): Promise<DeliveryStats> {
    const timeZone = query.timeZone ?? 'UTC';
    const until = query.until ?? now;
    // Whole calendar days in the viewer's zone: from the first day's local midnight (a per-day chart over a rolling
    // window would open on a partial day). Otherwise a rolling window — the last 24 hours.
    const days = query.days ? calendarDays(until, query.days, timeZone) : null;
    let since: Date;
    if (days) {
      const { rows } = await this.db.execute<{ since: string | Date }>(
        sql`select (${days[0]}::date::timestamp at time zone ${timeZone}) as since`,
      );
      since = asDate(rows[0].since);
    } else {
      since = query.since ?? new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    const conds: SQL[] = [
      sql`application = ${this.application}`,
      sql`attempted_at >= ${since}`,
      sql`attempted_at < ${until}`,
      // A test send checks the config — it isn't deliverability.
      sql`not is_test`,
    ];
    if (query.tenantId !== undefined) conds.push(sql`tenant_id = ${query.tenantId}`);
    const where = sql.join(conds, sql` and `);

    const [byChannel, byType, byDay, byReason] = await Promise.all([
      this.db.execute<{ channel: string; status: string; count: number }>(sql`
        select channel, status, count(*)::int as count
        from commons_notification_delivery
        where ${where}
        group by channel, status
      `),
      this.db.execute<{ notification_type: string; status: string; count: number }>(sql`
        select notification_type, status, count(*)::int as count
        from commons_notification_delivery
        where ${where}
        group by notification_type, status
      `),
      this.db.execute<{ day: string; count: number; failed: number }>(sql`
        select to_char(attempted_at at time zone ${timeZone}, 'YYYY-MM-DD') as day, count(*)::int as count,
               (count(*) filter (where status in ('failed', 'bounced')))::int as failed
        from commons_notification_delivery
        where ${where}
        group by 1
        order by 1
      `),
      // The reason's code — the part before a provider's own text ("provider_auth_failed: 401 …"); a bounce is one group.
      this.db.execute<{ status: string; reason: string; count: number }>(sql`
        select status,
               case when status = 'bounced' then 'bounced' else coalesce(nullif(trim(split_part(reason, ':', 1)), ''), 'unknown') end as reason,
               count(*)::int as count
        from commons_notification_delivery
        where ${where} and status in ('failed', 'skipped', 'bounced')
        group by 1, 2
        order by 3 desc, 2
      `),
    ]);

    const counted = new Map(byDay.rows.map((r) => [String(r.day), { count: Number(r.count), failed: Number(r.failed) }]));
    return {
      since,
      until,
      byChannel: byChannel.rows.map((r) => ({
        channel: r.channel as NotificationChannel,
        status: r.status as DeliveryRecord['status'],
        count: Number(r.count),
      })),
      byType: byType.rows.map((r) => ({
        notificationType: r.notification_type,
        status: r.status as DeliveryRecord['status'],
        count: Number(r.count),
      })),
      // Every day of a day window, a quiet one at 0; a rolling window lists the days it touched.
      byDay: (days ?? [...counted.keys()]).map((day) => ({ day, ...(counted.get(day) ?? { count: 0, failed: 0 }) })),
      byReason: byReason.rows.map((r) => ({
        status: r.status as DeliveryReasonCount['status'],
        reason: r.reason,
        count: Number(r.count),
      })),
    };
  }

  async volume(timeZone = 'UTC', now: Date = new Date()): Promise<DeliveryVolume> {
    const app = sql`application = ${this.application}`;
    const days = calendarDays(now, VOLUME_DAYS, timeZone);
    const [perDay, totals, size] = await Promise.all([
      this.db.execute<{ day: string; deliveries: number; failed: number; with_content: number }>(sql`
        select
          to_char(attempted_at at time zone ${timeZone}, 'YYYY-MM-DD') as day,
          count(*)::int as deliveries,
          count(*) filter (where status in ('failed', 'bounced'))::int as failed,
          count(*) filter (where content is not null)::int as with_content
        from commons_notification_delivery
        where ${app} and attempted_at >= (${days[0]}::date::timestamp at time zone ${timeZone})
        group by 1
      `),
      this.db.execute<{ oldest: string | Date | null; total: string | number; with_content: string | number; oldest_content: string | Date | null }>(sql`
        select min(attempted_at) as oldest, count(*)::bigint as total,
               count(*) filter (where content is not null)::bigint as with_content,
               min(attempted_at) filter (where content is not null) as oldest_content
        from commons_notification_delivery
        where ${app}
      `),
      this.db.execute<{ bytes: string | number | null }>(sql`select pg_total_relation_size('commons_notification_delivery') as bytes`),
    ]);
    const t = totals.rows[0];
    const byDay = new Map(perDay.rows.map((r) => [String(r.day), r]));
    return {
      oldestAttemptedAt: t?.oldest == null ? null : asDate(t.oldest),
      rowCount: Number(t?.total ?? 0),
      contentRowCount: Number(t?.with_content ?? 0),
      oldestContentAt: t?.oldest_content == null ? null : asDate(t.oldest_content),
      tableSizeBytes: size.rows[0]?.bytes == null ? null : Number(size.rows[0].bytes),
      perDay: days.map((day) => {
        const r = byDay.get(day);
        return { day, deliveries: Number(r?.deliveries ?? 0), failed: Number(r?.failed ?? 0), withContent: Number(r?.with_content ?? 0) };
      }),
    };
  }
}

interface DeliveryRow {
  id: string | number;
  notification_type: string;
  channel: string;
  tenant_id: string | null;
  recipient_ref: string;
  recipient_key: string | null;
  status: string;
  reason: string | null;
  provider_message_id: string | null;
  attempted_at: string | Date;
  updated_at: string | Date;
  correlation_id: string | null;
  has_content: boolean;
  is_test: boolean;
  retry_of: string | number | null;
  retried_by: string | number | null;
}

function mapRow(row: DeliveryRow): DeliveryRecord {
  return {
    id: String(row.id),
    notificationType: row.notification_type,
    channel: row.channel as NotificationChannel,
    tenantId: row.tenant_id,
    recipientRef: row.recipient_ref,
    recipientKey: row.recipient_key ?? null,
    status: row.status as DeliveryRecord['status'],
    reason: row.reason,
    providerMessageId: row.provider_message_id,
    attemptedAt: asDate(row.attempted_at),
    updatedAt: asDate(row.updated_at),
    correlationId: row.correlation_id,
    hasContent: row.has_content === true,
    isTest: row.is_test === true,
    retryOf: row.retry_of == null ? null : String(row.retry_of),
    retriedBy: row.retried_by == null ? null : String(row.retried_by),
  };
}

function asDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}
