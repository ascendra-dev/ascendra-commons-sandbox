import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  calendarDays,
  decodeKeysetCursor,
  fillDailyCounts,
  encodeKeysetCursor,
  InvalidRateLimitCursorError,
  type IdentifierRejectionCount,
  type RateLimitObservabilityPort,
  type RateLimitRejectionRecord,
  type RejectionPage,
  type RejectionQuery,
  type RejectionVolume,
  type RouteRejectionCount,
  type TopIdentifiersQuery,
} from '../../rate-limiting.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { RATE_LIMIT_APPLICATION_ID, RATE_LIMIT_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_TOP_IDENTIFIERS = 10;
const MAX_TOP_IDENTIFIERS = 100;
const VOLUME_DAYS = 30;

/**
 * Reference `RateLimitObservabilityPort` for Postgres — one dynamic
 * `SELECT` over the rejection windows, keyset-paginated newest-first on the
 * immutable `window_start` (a window's count and last-seen keep growing, so
 * they can't be the sort key), plus one aggregate query for
 * `rejectionCatalog()`, `topIdentifiers()` and `volume()`. Read-only. Scoped to one `application`.
 */
@Injectable()
export class PostgresRateLimitObservabilityService implements RateLimitObservabilityPort {
  constructor(
    @Inject(RATE_LIMIT_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(RATE_LIMIT_APPLICATION_ID) private readonly application: string,
  ) {}

  async listRejections(query: RejectionQuery = {}): Promise<RejectionPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.route !== undefined) conds.push(sql`route = ${query.route}`);
    if (query.identifier !== undefined) conds.push(sql`identifier = ${query.identifier}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`window_start >= ${query.since}`);
    if (query.until) conds.push(sql`window_start < ${query.until}`);

    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor);
      // Row ids are bigserial — anything else would only fail as a cast error inside Postgres.
      if (!cursor || !/^\d+$/.test(cursor.id)) throw new InvalidRateLimitCursorError('Not a cursor this log returned');
      conds.push(sql`(window_start < ${cursor.timestamp} or (window_start = ${cursor.timestamp} and id < ${cursor.id}))`);
    }

    const rows = (
      await this.db.execute(sql`
        select id, route, identifier, "limit", ttl_ms, window_start, rejection_count,
               first_rejected_at, last_rejected_at, correlation_id
        from commons_rate_limit_rejection
        where ${sql.join(conds, sql` and `)}
        order by window_start desc, id desc
        limit ${limit + 1}
      `)
    ).rows.map(mapRow);

    if (rows.length > limit) {
      const rejections = rows.slice(0, limit);
      const last = rejections[rejections.length - 1];
      return { rejections, nextCursor: encodeKeysetCursor(last.windowStart, last.id) };
    }
    return { rejections: rows };
  }

  async rejectionCatalog(since?: Date): Promise<RouteRejectionCount[]> {
    const conds: SQL[] = [sql`application = ${this.application}`];
    if (since) conds.push(sql`window_start >= ${since}`);

    const { rows } = await this.db.execute(sql`
      select route, sum(rejection_count) as count
      from commons_rate_limit_rejection
      where ${sql.join(conds, sql` and `)}
      group by route
      order by count desc
    `);

    return rows.map((row) => ({ route: String(row.route), count: Number(row.count) }));
  }

  async topIdentifiers(query: TopIdentifiersQuery = {}): Promise<IdentifierRejectionCount[]> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_TOP_IDENTIFIERS), MAX_TOP_IDENTIFIERS);
    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.since) conds.push(sql`window_start >= ${query.since}`);
    if (query.route !== undefined) conds.push(sql`route = ${query.route}`);

    const { rows } = await this.db.execute(sql`
      select identifier, sum(rejection_count) as count,
             array_agg(distinct route order by route) as routes, max(last_rejected_at) as last_rejected_at
      from commons_rate_limit_rejection
      where ${sql.join(conds, sql` and `)}
      group by identifier
      order by count desc, identifier
      limit ${limit}
    `);

    return rows.map((row) => ({
      identifier: String(row.identifier),
      count: Number(row.count),
      routes: (row.routes as unknown[]).map(String),
      lastRejectedAt: toDate(row.last_rejected_at),
    }));
  }
  async volume(timeZone = 'UTC', now: Date = new Date()): Promise<RejectionVolume> {
    const app = sql`application = ${this.application}`;
    // Whole calendar days in the viewer's zone: from the first day's local midnight, bucketed by local date.
    const days = calendarDays(now, VOLUME_DAYS, timeZone);
    const perDayRows = (
      await this.db.execute(sql`
        select to_char(window_start at time zone ${timeZone}, 'YYYY-MM-DD') as day, sum(rejection_count)::bigint as count
        from commons_rate_limit_rejection
        where ${app} and window_start >= (${days[0]}::date::timestamp at time zone ${timeZone})
        group by 1
      `)
    ).rows as Array<{ day: string; count: string | number }>;

    const totals = (
      await this.db.execute(sql`
        select min(window_start) as oldest, count(*)::bigint as total
        from commons_rate_limit_rejection
        where ${app}
      `)
    ).rows[0] as { oldest: unknown; total: string | number } | undefined;

    const size = (await this.db.execute(sql`select pg_total_relation_size('commons_rate_limit_rejection') as bytes`)).rows[0] as
      | { bytes: string | number | null }
      | undefined;

    return {
      oldestWindowAt: totals?.oldest == null ? null : toDate(totals.oldest),
      rowCount: Number(totals?.total ?? 0),
      tableSizeBytes: size?.bytes == null ? null : Number(size.bytes),
      perDay: fillDailyCounts(days, new Map(perDayRows.map((r) => [r.day, Number(r.count)]))),
    };
  }
}

function mapRow(row: Record<string, unknown>): RateLimitRejectionRecord {
  return {
    id: String(row.id),
    route: String(row.route),
    identifier: String(row.identifier),
    limit: Number(row.limit),
    ttlMs: Number(row.ttl_ms),
    windowStart: toDate(row.window_start),
    count: Number(row.rejection_count),
    firstRejectedAt: toDate(row.first_rejected_at),
    lastRejectedAt: toDate(row.last_rejected_at),
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
  };
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}
