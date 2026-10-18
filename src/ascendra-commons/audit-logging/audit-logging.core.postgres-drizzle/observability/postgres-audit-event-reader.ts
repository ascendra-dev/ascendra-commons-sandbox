import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  parseStatsWindow,
  type ActorActivityQuery,
  type ActorActivitySummary,
  type AuditCoverageEntry,
  type AuditCoverageQuery,
  type AuditEvent,
  type AuditEventReader,
  type AuditQuery,
  type AuditQueryResult,
  type AuditStats,
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
 * Scoped to one `application` — an app's own compliance/ops screen. A
 * cross-product compliance view that needs *every* app's rows queries
 * `commons_audit_event` directly.
 *
 * Corresponding table: `../persistence/audit-event.schema.ts` (DDL: `../migrations/`).
 */
@Injectable()
export class PostgresAuditEventReader implements AuditEventReader {
  constructor(
    @Inject(AUDIT_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(AUDIT_APPLICATION_ID) private readonly application: string,
  ) {}

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
    const conds: SQL[] = [sql`id = ${id}`, sql`application = ${this.application}`];
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
    const conds: SQL[] = [sql`application = ${this.application}`, sql`actor = ${actor}`];
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
        select action, count(*)::int as count, max(occurred_at) as last_occurred_at
        from commons_audit_event
        where ${where}
        group by action
        order by count(*) desc, action asc
      `)
    ).rows as Array<{ action: string; count: number; last_occurred_at: unknown }>;

    return {
      actor,
      firstSeen: overall.first_seen == null ? null : asDate(overall.first_seen),
      lastSeen: overall.last_seen == null ? null : asDate(overall.last_seen),
      totalRecords: overall.total ?? 0,
      tenantsTouched: overall.tenants ?? [],
      byAction: byActionRows.map((r) => ({ action: r.action, count: r.count, lastOccurredAt: asDate(r.last_occurred_at) })),
    };
  }

  async stats(window: string, tenantId?: string | null): Promise<AuditStats> {
    const { label, since } = parseStatsWindow(window);
    const conds: SQL[] = [sql`application = ${this.application}`, sql`occurred_at >= ${since}`];
    if (tenantId !== undefined) {
      conds.push(tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${tenantId}`);
    }
    const where = sql.join(conds, sql` and `);

    const perDayRows = (
      await this.db.execute(sql`
        select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day, count(*)::int as count
        from commons_audit_event
        where ${where}
        group by 1
        order by 1
      `)
    ).rows as Array<{ day: string; count: number }>;

    const topActionRows = (
      await this.db.execute(sql`
        select action, count(*)::int as count
        from commons_audit_event
        where ${where}
        group by action
        order by count(*) desc, action asc
        limit 10
      `)
    ).rows as Array<{ action: string; count: number }>;

    const topActorRows = (
      await this.db.execute(sql`
        select actor, count(*)::int as count
        from commons_audit_event
        where ${where}
        group by actor
        order by count(*) desc, actor asc
        limit 10
      `)
    ).rows as Array<{ actor: string; count: number }>;

    const perTenantRows = (
      await this.db.execute(sql`
        select tenant_id, count(*)::int as count
        from commons_audit_event
        where ${where}
        group by tenant_id
        order by count(*) desc
      `)
    ).rows as Array<{ tenant_id: string | null; count: number }>;

    return {
      window: label,
      perDay: perDayRows.map((r) => ({ day: r.day, count: r.count })),
      topActions: topActionRows.map((r) => ({ action: r.action, count: r.count })),
      topActors: topActorRows.map((r) => ({ actor: r.actor, count: r.count })),
      perTenant: perTenantRows.map((r) => ({ tenantId: r.tenant_id, count: r.count })),
    };
  }

  async countByDeclared(query: AuditCoverageQuery): Promise<AuditCoverageEntry[]> {
    const declaredEntityTypes = [...new Set(query.entityTypes)];
    const declaredActions = [...new Set(query.actions)];

    const conds: SQL[] = [sql`application = ${this.application}`];
    if ('tenantId' in query) {
      conds.push(query.tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${query.tenantId}`);
    }

    const entityCounts = new Map<string, number>();
    if (declaredEntityTypes.length > 0) {
      const rows = (
        await this.db.execute(sql`
          select entity_type, count(*)::int as count
          from commons_audit_event
          where ${sql.join([...conds, sql`entity_type = any(${declaredEntityTypes})`], sql` and `)}
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
          where ${sql.join([...conds, sql`action = any(${declaredActions})`], sql` and `)}
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
  /** `AuditQuery`'s filter fields as ANDable conditions — shared by `find()` and `countUpTo()`; ignores `limit`/`cursor`. */
  private filterConds(query: AuditQuery): SQL[] {
    const conds: SQL[] = [sql`application = ${this.application}`];
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
