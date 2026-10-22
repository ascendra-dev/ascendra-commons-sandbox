import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  calendarDays,
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidDeliveryCursorError,
  type DeliveryPage,
  type DeliveryPeriodQuery,
  type DeliveryQuery,
  type DeliverySummary,
  type DeliveryVolume,
  type EventDeliveryCatalogEntry,
  type EventDeliveryObservabilityPort,
  type EventDeliveryRecord,
} from '../../domain-events.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { EVENT_DELIVERY_APPLICATION_ID, EVENT_DELIVERY_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const VOLUME_DAYS = 30;

/**
 * Reference `EventDeliveryObservabilityPort` for Postgres — the list (one dynamic `SELECT`, keyset-paginated), the
 * summary, the per-event catalog and the volume. Read-only: no `INSERT`/`UPDATE`/`DELETE` path exists here, so
 * "deliveries are write-once" holds exactly as `PostgresEventDeliveryRecorder` intends.
 *
 * Every read is on `occurred_at` — the business fact's own time — and scoped to one `application`. Corresponding
 * table: `../persistence/domain-event-delivery.schema.ts` (DDL: `../migrations/`).
 */
@Injectable()
export class PostgresEventDeliveryObservabilityService implements EventDeliveryObservabilityPort {
  constructor(
    @Inject(EVENT_DELIVERY_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(EVENT_DELIVERY_APPLICATION_ID) private readonly application: string,
  ) {}

  async listDeliveries(query: DeliveryQuery = {}): Promise<DeliveryPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const asc = query.order === 'asc';
    const dir = asc ? sql`asc` : sql`desc`;

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.eventName !== undefined) conds.push(sql`event_name = ${query.eventName}`);
    if (query.method !== undefined) conds.push(sql`method = ${query.method}`);
    if (query.status !== undefined) conds.push(sql`status = ${query.status}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`occurred_at >= ${query.since}`);
    if (query.until) conds.push(sql`occurred_at < ${query.until}`);

    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor);
      // A cursor that doesn't decode was never issued here — silently starting from the top would repeat page one.
      if (!cursor) throw new InvalidDeliveryCursorError(`Unrecognized cursor "${query.cursor}"`);
      // The leading bound lets the scan start at the boundary (an Index Cond); the OR alone is only a Filter.
      conds.push(
        asc
          ? sql`occurred_at >= ${cursor.timestamp} and (occurred_at > ${cursor.timestamp} or id > ${cursor.id})`
          : sql`occurred_at <= ${cursor.timestamp} and (occurred_at < ${cursor.timestamp} or id < ${cursor.id})`,
      );
    }

    const rows = (
      await this.db.execute(sql`
        select id, event_name, method, transport, occurred_at, delivered_at, listener_count, status, reason, correlation_id
        from commons_domain_events_delivery
        where ${sql.join(conds, sql` and `)}
        order by occurred_at ${dir}, id ${dir}
        limit ${limit + 1}
      `)
    ).rows.map(mapRow);

    if (rows.length > limit) {
      const deliveries = rows.slice(0, limit);
      const last = deliveries[deliveries.length - 1];
      return { deliveries, nextCursor: encodeKeysetCursor(last.occurredAt, last.id) };
    }
    return { deliveries: rows };
  }

  async deliverySummary(query: DeliveryPeriodQuery = {}): Promise<DeliverySummary> {
    const row = (
      await this.db.execute(sql`
        select
          count(*)::bigint as total,
          count(*) filter (where status = 'delivered')::bigint as delivered,
          count(*) filter (where status = 'no_listeners')::bigint as no_listeners,
          count(*) filter (where status = 'dispatch_failed')::bigint as dispatch_failed,
          count(*) filter (where method = 'emitCritical')::bigint as critical,
          count(distinct event_name)::bigint as event_names
        from commons_domain_events_delivery
        where ${this.period(query)}
      `)
    ).rows[0] as Record<string, unknown> | undefined;
    return {
      total: Number(row?.total ?? 0),
      delivered: Number(row?.delivered ?? 0),
      noListeners: Number(row?.no_listeners ?? 0),
      dispatchFailed: Number(row?.dispatch_failed ?? 0),
      critical: Number(row?.critical ?? 0),
      eventNames: Number(row?.event_names ?? 0),
    };
  }

  async deliveryCatalog(query: DeliveryPeriodQuery = {}): Promise<EventDeliveryCatalogEntry[]> {
    const { rows } = await this.db.execute(sql`
      select
        event_name,
        count(*)::bigint as total,
        count(*) filter (where method = 'emit')::bigint as emit_count,
        count(*) filter (where method = 'emitCritical')::bigint as emit_critical_count,
        count(*) filter (where status = 'no_listeners')::bigint as no_listener_count,
        count(*) filter (where status = 'dispatch_failed')::bigint as dispatch_failed_count,
        max(occurred_at) as last_occurred_at,
        (array_agg(listener_count order by occurred_at desc, id desc))[1] as last_listener_count
      from commons_domain_events_delivery
      where ${this.period(query)}
      group by event_name
      order by count(*) desc, event_name
    `);

    return rows.map((row) => ({
      eventName: String(row.event_name),
      total: Number(row.total),
      emitCount: Number(row.emit_count),
      emitCriticalCount: Number(row.emit_critical_count),
      noListenerCount: Number(row.no_listener_count),
      dispatchFailedCount: Number(row.dispatch_failed_count),
      lastOccurredAt: toDate(row.last_occurred_at),
      lastListenerCount: Number(row.last_listener_count),
    }));
  }

  async volume(timeZone = 'UTC', now: Date = new Date()): Promise<DeliveryVolume> {
    const app = sql`application = ${this.application}`;
    // Whole calendar days in the viewer's zone: from the first day's local midnight, bucketed by local date.
    const days = calendarDays(now, VOLUME_DAYS, timeZone);
    const perDayRows = (
      await this.db.execute(sql`
        select
          to_char(occurred_at at time zone ${timeZone}, 'YYYY-MM-DD') as day,
          count(*)::bigint as count,
          count(*) filter (where status = 'no_listeners')::bigint as no_listener_count,
          count(*) filter (where status = 'dispatch_failed')::bigint as dispatch_failed_count
        from commons_domain_events_delivery
        where ${app} and occurred_at >= (${days[0]}::date::timestamp at time zone ${timeZone})
        group by 1
      `)
    ).rows as Array<Record<string, unknown>>;

    const totals = (
      await this.db.execute(sql`
        select min(occurred_at) as oldest, count(*)::bigint as total
        from commons_domain_events_delivery
        where ${app}
      `)
    ).rows[0] as { oldest: unknown; total: string | number } | undefined;

    const size = (await this.db.execute(sql`select pg_total_relation_size('commons_domain_events_delivery') as bytes`)).rows[0] as
      | { bytes: string | number | null }
      | undefined;

    const byDay = new Map(perDayRows.map((r) => [String(r.day), r]));
    return {
      oldestOccurredAt: totals?.oldest == null ? null : toDate(totals.oldest),
      rowCount: Number(totals?.total ?? 0),
      tableSizeBytes: size?.bytes == null ? null : Number(size.bytes),
      perDay: days.map((day) => {
        const r = byDay.get(day);
        return {
          day,
          count: Number(r?.count ?? 0),
          noListenerCount: Number(r?.no_listener_count ?? 0),
          dispatchFailedCount: Number(r?.dispatch_failed_count ?? 0),
        };
      }),
    };
  }

  private period(query: DeliveryPeriodQuery): SQL {
    const app = sql`application = ${this.application}`;
    return query.since ? sql`${app} and occurred_at >= ${query.since}` : app;
  }
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapRow(row: Record<string, unknown>): EventDeliveryRecord {
  return {
    id: String(row.id),
    eventName: String(row.event_name),
    method: row.method as EventDeliveryRecord['method'],
    transport: String(row.transport),
    occurredAt: toDate(row.occurred_at),
    deliveredAt: toDate(row.delivered_at),
    listenerCount: Number(row.listener_count),
    status: row.status as EventDeliveryRecord['status'],
    reason: row.reason == null ? null : String(row.reason),
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
  };
}
