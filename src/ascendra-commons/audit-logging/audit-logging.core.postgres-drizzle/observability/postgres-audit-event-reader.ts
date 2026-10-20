import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  calendarDays,
  fillDailyCounts,
  fillMonthlyCounts,
  kpiValue,
  parseStatsWindow,
  type ActorActivityQuery,
  type ActorActivitySummary,
  type AuditCoverageEntry,
  type AuditCoverageQuery,
  type AuditEvent,
  type AuditEventReader,
  type AuditQuery,
  type AuditOverviewStats,
  type AuditQueryResult,
  type AuditRetentionStats,
  type AuditTopActionsStats,
} from '../../audit-logging.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { AUDIT_APPLICATION_ID, AUDIT_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Reference `AuditEventReader` for Postgres via Drizzle — one library-owned
 * `SELECT` with a dynamic `WHERE`, keyset-paginated newest-first. Read-only:
 * no `INSERT`/`UPDATE`/`DELETE` path exists, so "audit records are write-once"
 * holds exactly as before.
 *
 * Scoped to the configured `application`(s) — one for an app's own
 * compliance/ops screen, several for a backend that serves more than one
 * application (`AuditQuery.application` then narrows to one of them).
 *
 * Corresponding table: `../persistence/audit-event.schema.ts` (DDL: `../migrations/`).
 */
@Injectable()
export class PostgresAuditEventReader implements AuditEventReader {
  constructor(
    @Inject(AUDIT_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(AUDIT_APPLICATION_ID) application: string | string[],
  ) {
    this.scopedApplications = [application].flat();
  }

  private readonly scopedApplications: string[];

  applications(): string[] {
    return [...this.scopedApplications];
  }

  async find(query: AuditQuery): Promise<AuditQueryResult> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds = this.filterConds(query);
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor) : null;
    if (cursor) {
      conds.push(
        sql`(occurred_at < ${cursor.timestamp} or (occurred_at = ${cursor.timestamp} and id < ${cursor.id}))`,
      );
    }

    const rows = (
      await this.db.execute(sql`
        select id, entity_type, entity_id, tenant_id, actor, action, before, after, correlation_id, reason, occurred_at, application
        from commons_audit_event
        where ${sql.join(conds, sql` and `)}
        order by occurred_at desc, id desc
        limit ${limit + 1}
      `)
    ).rows.map(mapRow);

    if (rows.length > limit) {
      const records = rows.slice(0, limit);
      const last = records[records.length - 1];
      return { records, nextCursor: encodeKeysetCursor(last.occurredAt, last.id) };
    }
    return { records: rows };
  }

  async countUpTo(query: AuditQuery, max: number): Promise<number> {
    const rows = (
      await this.db.execute(sql`
        select count(*)::int as count
        from (
          select 1 from commons_audit_event
          where ${sql.join(this.filterConds(query), sql` and `)}
          limit ${max}
        ) as capped
      `)
    ).rows as Array<{ count: number }>;
    return rows[0]?.count ?? 0;
  }

  async findOne(id: string, tenantId?: string | null): Promise<AuditEvent | null> {
    const conds: SQL[] = [sql`id = ${id}`, this.inScope()];
    if (tenantId !== undefined) {
      conds.push(tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${tenantId}`);
    }

    const rows = (
      await this.db.execute(sql`
        select id, entity_type, entity_id, tenant_id, actor, action, before, after, correlation_id, reason, occurred_at, application
        from commons_audit_event
        where ${sql.join(conds, sql` and `)}
        limit 1
      `)
    ).rows;
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async summarizeActor(actor: string, query: ActorActivityQuery): Promise<ActorActivitySummary> {
    const conds: SQL[] = [this.inScope(), sql`actor = ${actor}`];
    if ('tenantId' in query) {
      conds.push(query.tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${query.tenantId}`);
    }
    if (query.occurredAfter) conds.push(sql`occurred_at >= ${query.occurredAfter}`);
    if (query.occurredBefore) conds.push(sql`occurred_at < ${query.occurredBefore}`);
    const where = sql.join(conds, sql` and `);

    const overallRows = (
      await this.db.execute(sql`
        select min(occurred_at) as first_seen, max(occurred_at) as last_seen,
               count(*)::int as total, array_agg(distinct tenant_id) as tenants
        from commons_audit_event
        where ${where}
      `)
    ).rows as Array<{ first_seen: unknown; last_seen: unknown; total: number; tenants: Array<string | null> | null }>;
    const overall = overallRows[0];

    const byActionRows = (
      await this.db.execute(sql`
        select entity_type, action, count(*)::int as count, max(occurred_at) as last_occurred_at
        from commons_audit_event
        where ${where}
        group by entity_type, action
        order by count(*) desc, entity_type asc, action asc
      `)
    ).rows as Array<{ entity_type: string; action: string; count: number; last_occurred_at: unknown }>;

    return {
      actor,
      firstSeen: overall.first_seen == null ? null : asDate(overall.first_seen),
      lastSeen: overall.last_seen == null ? null : asDate(overall.last_seen),
      totalRecords: overall.total ?? 0,
      tenantsTouched: overall.tenants ?? [],
      byAction: byActionRows.map((r) => ({
        entityType: r.entity_type,
        action: r.action,
        count: r.count,
        lastOccurredAt: asDate(r.last_occurred_at),
      })),
    };
  }

  async overviewStats(
    window: string,
    tenantId?: string | null,
    timeZone = 'UTC',
    now: Date = new Date(),
  ): Promise<AuditOverviewStats> {
    const { label, days } = parseStatsWindow(window, now);
    const scope = this.scope(tenantId);

    // Whole calendar days in the viewer's zone: from the first day's local midnight, bucketed by local date.
    const dayList = calendarDays(now, days, timeZone);
    const perDayRows = (
      await this.db.execute(sql`
        select to_char(occurred_at at time zone ${timeZone}, 'YYYY-MM-DD') as day, count(*)::int as count
        from commons_audit_event
        where ${scope} and occurred_at >= (${dayList[0]}::date::timestamp at time zone ${timeZone})
        group by 1
      `)
    ).rows as Array<{ day: string; count: number }>;

    // Each KPI against the equal period before it — one pass over the past 60 days (the widest pair, 30 + 30).
    const ago = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const [d1, d2, d7, d14, d30, d60] = [1, 2, 7, 14, 30, 60].map(ago);
    const kpiRows = (
      await this.db.execute(sql`
        select
          count(*) filter (where occurred_at >= ${d1})::int as records_24h,
          count(*) filter (where occurred_at >= ${d2} and occurred_at < ${d1})::int as records_24h_prior,
          count(*) filter (where occurred_at >= ${d7})::int as records_7d,
          count(*) filter (where occurred_at >= ${d14} and occurred_at < ${d7})::int as records_7d_prior,
          count(distinct actor) filter (where occurred_at >= ${d30})::int as actors_30d,
          count(distinct actor) filter (where occurred_at < ${d30})::int as actors_30d_prior,
          count(distinct entity_type) filter (where occurred_at >= ${d30})::int as entity_types_30d,
          count(distinct entity_type) filter (where occurred_at < ${d30})::int as entity_types_30d_prior
        from commons_audit_event
        where ${scope} and occurred_at >= ${d60} and occurred_at <= ${now}
      `)
    ).rows as Array<Record<string, number>>;
    const k = kpiRows[0];

    return {
      window: label,
      perDay: fillDailyCounts(dayList, new Map(perDayRows.map((r) => [r.day, r.count]))),
      kpis: {
        records24h: kpiValue(k.records_24h, k.records_24h_prior),
        records7d: kpiValue(k.records_7d, k.records_7d_prior),
        distinctActors30d: kpiValue(k.actors_30d, k.actors_30d_prior),
        entityTypes30d: kpiValue(k.entity_types_30d, k.entity_types_30d_prior),
      },
    };
  }

  async topActions(window: string, tenantId?: string | null): Promise<AuditTopActionsStats> {
    const { label, since } = parseStatsWindow(window);
    const rows = (
      await this.db.execute(sql`
        select entity_type, action, count(*)::int as count, count(distinct actor)::int as actors
        from commons_audit_event
        where ${this.scope(tenantId)} and occurred_at >= ${since}
        group by entity_type, action
        order by count(*) desc, entity_type asc, action asc
        limit 10
      `)
    ).rows as Array<{ entity_type: string; action: string; count: number; actors: number }>;
    return {
      window: label,
      topActions: rows.map((r) => ({ entityType: r.entity_type, action: r.action, count: r.count, actors: r.actors })),
    };
  }

  async retention(tenantId?: string | null, now: Date = new Date()): Promise<AuditRetentionStats> {
    const scope = this.scope(tenantId);
    const totals = (
      await this.db.execute(sql`
        select min(occurred_at) as oldest, count(*)::bigint as total
        from commons_audit_event
        where ${scope}
      `)
    ).rows[0] as { oldest: unknown; total: string | number };

    const perMonthRows = (
      await this.db.execute(sql`
        select to_char(occurred_at at time zone 'UTC', 'YYYY-MM') as month, count(*)::bigint as count
        from commons_audit_event
        where ${scope}
        group by 1
      `)
    ).rows as Array<{ month: string; count: string | number }>;

    // The whole table's size — only meaningful unscoped; a tenant's share of a table has no size of its own.
    let tableSizeBytes: number | null = null;
    if (tenantId === undefined) {
      const size = (await this.db.execute(sql`select pg_total_relation_size('commons_audit_event') as bytes`)).rows[0] as
        | { bytes: string | number | null }
        | undefined;
      tableSizeBytes = size?.bytes == null ? null : Number(size.bytes);
    }

    const oldestRecordAt = totals.oldest == null ? null : asDate(totals.oldest);
    return {
      oldestRecordAt,
      rowCount: Number(totals.total ?? 0),
      tableSizeBytes,
      perMonth: fillMonthlyCounts(oldestRecordAt, now, new Map(perMonthRows.map((r) => [r.month, Number(r.count)]))),
    };
  }

  async countByDeclared(query: AuditCoverageQuery): Promise<AuditCoverageEntry[]> {
    const declaredEntityTypes = [...new Set(query.entityTypes)];
    const declaredActions = [...new Set(query.actions)];

    const conds: SQL[] = [this.inScope()];
    if ('tenantId' in query) {
      conds.push(query.tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${query.tenantId}`);
    }

    const entityCounts = new Map<string, number>();
    if (declaredEntityTypes.length > 0) {
      const rows = (
        await this.db.execute(sql`
          select entity_type, count(*)::int as count
          from commons_audit_event
          where ${sql.join([...conds, sql`entity_type in ${declaredEntityTypes}`], sql` and `)}
          group by entity_type
        `)
      ).rows as Array<{ entity_type: string; count: number }>;
      for (const row of rows) entityCounts.set(row.entity_type, row.count);
    }

    const actionCounts = new Map<string, number>();
    if (declaredActions.length > 0) {
      const rows = (
        await this.db.execute(sql`
          select action, count(*)::int as count
          from commons_audit_event
          where ${sql.join([...conds, sql`action in ${declaredActions}`], sql` and `)}
          group by action
        `)
      ).rows as Array<{ action: string; count: number }>;
      for (const row of rows) actionCounts.set(row.action, row.count);
    }

    const toEntry = (kind: AuditCoverageEntry['kind'], value: string, count: number): AuditCoverageEntry => ({
      kind,
      value,
      count,
      assessment: count > 0 ? 'healthy' : 'never_audited',
    });

    return [
      ...declaredEntityTypes.map((value) => toEntry('entityType', value, entityCounts.get(value) ?? 0)),
      ...declaredActions.map((value) => toEntry('action', value, actionCounts.get(value) ?? 0)),
    ];
  }
  /** Rows of the application(s) this reader is scoped to. */
  private inScope(): SQL {
    return sql`application in ${this.scopedApplications}`;
  }

  /** This app's rows, narrowed to one tenant (a string), platform-level rows (`null`), or none (absent). */
  private scope(tenantId?: string | null): SQL {
    const conds: SQL[] = [this.inScope()];
    if (tenantId !== undefined) conds.push(tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${tenantId}`);
    return sql.join(conds, sql` and `);
  }

  /** `AuditQuery`'s filter fields as ANDable conditions — shared by `find()` and `countUpTo()`; ignores `limit`/`cursor`. */
  private filterConds(query: AuditQuery): SQL[] {
    const conds: SQL[] = [this.inScope()];
    if (query.application !== undefined) conds.push(sql`application = ${query.application}`);
    if (query.entityType !== undefined) conds.push(sql`entity_type = ${query.entityType}`);
    if (query.entityId !== undefined) conds.push(sql`entity_id = ${query.entityId}`);
    if ('tenantId' in query) {
      conds.push(query.tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${query.tenantId}`);
    }
    if (query.actor !== undefined) conds.push(sql`actor = ${query.actor}`);
    if (query.action !== undefined) conds.push(sql`action = ${query.action}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.occurredAfter) conds.push(sql`occurred_at >= ${query.occurredAfter}`);
    if (query.occurredBefore) conds.push(sql`occurred_at < ${query.occurredBefore}`);
    return conds;
  }
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapRow(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    tenantId: row.tenant_id == null ? null : String(row.tenant_id),
    actor: String(row.actor),
    action: String(row.action),
    before: (row.before ?? null) as Record<string, unknown> | null,
    after: (row.after ?? null) as Record<string, unknown> | null,
    correlationId: String(row.correlation_id),
    application: String(row.application),
    reason: row.reason == null ? null : String(row.reason),
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at : new Date(String(row.occurred_at)),
  };
}
