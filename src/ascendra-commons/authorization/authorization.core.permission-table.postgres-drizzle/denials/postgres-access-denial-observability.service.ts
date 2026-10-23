import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  InvalidAuthzCursorError,
  type AccessDenialObservabilityPort,
  type AccessDenialPage,
  type AccessDenialQuery,
  type AccessDenialSummary,
  type AccessDenialView,
} from '../../authorization.core.permission-table';
import { decodeCursor, encodeCursor, isoMicros } from '../persistence/sql-helpers';
import type { SqlExecutor } from '../persistence/sql-executor';
import { DENIAL_APPLICATION_ID, DENIAL_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const TOP = 10;

/**
 * `AccessDenialObservabilityPort` for Postgres — the denied-requests log, newest first, and its summary. Every read is
 * `application`-scoped and on `window_start`, each on an index (`../migrations/0003_authorization_access_denials.sql`).
 */
@Injectable()
export class PostgresAccessDenialObservabilityService implements AccessDenialObservabilityPort {
  constructor(
    @Inject(DENIAL_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(DENIAL_APPLICATION_ID) private readonly application: string,
  ) {}

  async listDenials(query: AccessDenialQuery = {}): Promise<AccessDenialPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.actorId !== undefined) conds.push(sql`actor_id = ${query.actorId}`);
    if (query.tenantId !== undefined) conds.push(sql`tenant_id = ${query.tenantId}`);
    if (query.action !== undefined) conds.push(sql`action = ${query.action}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`window_start >= ${query.since}`);
    if (query.until) conds.push(sql`window_start < ${query.until}`);
    if (query.cursor) {
      const c = decodeCursor(query.cursor, ['ts', 'id']);
      if (!c || !/^\d+$/.test(c.id!)) throw new InvalidAuthzCursorError(query.cursor);
      const ts = sql`${c.ts}::timestamptz`;
      conds.push(sql`window_start <= ${ts} and (window_start < ${ts} or id < ${c.id}::bigint)`);
    }
    const { rows } = await this.db.execute<DenialRow>(sql`
      select id, actor_id, tenant_id, action, method, route, window_start, denial_count, first_denied_at, last_denied_at,
             correlation_id, ${isoMicros('window_start', 'window_start_key')}
      from commons_authz_denial
      where ${sql.join(conds, sql` and `)}
      order by window_start desc, id desc
      limit ${limit + 1}
    `);
    const page = rows.slice(0, limit);
    const denials = page.map(toView);
    if (rows.length > limit) {
      const last = page[page.length - 1];
      return { denials, nextCursor: encodeCursor({ ts: last.window_start_key, id: String(last.id) }) };
    }
    return { denials };
  }

  async denialSummary(query: { tenantId?: string; since?: Date } = {}): Promise<AccessDenialSummary> {
    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.tenantId !== undefined) conds.push(sql`tenant_id = ${query.tenantId}`);
    if (query.since) conds.push(sql`window_start >= ${query.since}`);
    const where = sql.join(conds, sql` and `);

    const [{ rows: [totals] }, { rows: actions }, { rows: actors }] = await Promise.all([
      this.db.execute<{ total: string | number; actors: string | number }>(sql`
        select coalesce(sum(denial_count), 0) as total, count(distinct actor_id) as actors
        from commons_authz_denial where ${where}
      `),
      this.db.execute<{ action: string; count: string | number; actors: string | number }>(sql`
        select action, sum(denial_count) as count, count(distinct actor_id) as actors
        from commons_authz_denial where ${where}
        group by action order by 2 desc, action limit ${TOP}
      `),
      this.db.execute<{ actor_id: string; tenant_id: string | null; count: string | number; actions: string | number }>(sql`
        select actor_id, tenant_id, sum(denial_count) as count, count(distinct action) as actions
        from commons_authz_denial where ${where}
        group by actor_id, tenant_id order by 3 desc, actor_id limit ${TOP}
      `),
    ]);
    return {
      total: Number(totals?.total ?? 0),
      actors: Number(totals?.actors ?? 0),
      topActions: actions.map((a) => ({ action: a.action, count: Number(a.count), actors: Number(a.actors) })),
      topActors: actors.map((a) => ({ actorId: a.actor_id, tenantId: a.tenant_id, count: Number(a.count), actions: Number(a.actions) })),
    };
  }
}

/** Deletes denial windows older than a cutoff, in batches — the app schedules it (e.g. a background-jobs job). */
@Injectable()
export class PostgresAccessDenialRetention {
  constructor(
    @Inject(DENIAL_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(DENIAL_APPLICATION_ID) private readonly application: string,
  ) {}

  /** Rows (windows) deleted. Batches of 5,000 — a backlog never holds one long lock on the table the recorder writes. */
  async pruneDenials(cutoff: Date, batchSize = 5_000): Promise<number> {
    let total = 0;
    for (;;) {
      const { rows } = await this.db.execute<{ id: string }>(sql`
        with doomed as (
          select id from commons_authz_denial
          where application = ${this.application} and window_start < ${cutoff}
          limit ${batchSize}
        )
        delete from commons_authz_denial where id in (select id from doomed)
        returning id
      `);
      total += rows.length;
      if (rows.length < batchSize) return total;
    }
  }
}

interface DenialRow {
  id: string | number;
  actor_id: string;
  tenant_id: string | null;
  action: string;
  method: string;
  route: string;
  window_start: string | Date;
  denial_count: string | number;
  first_denied_at: string | Date;
  last_denied_at: string | Date;
  correlation_id: string | null;
  window_start_key: string;
}

function toView(r: DenialRow): AccessDenialView {
  return {
    id: String(r.id),
    actorId: r.actor_id,
    tenantId: r.tenant_id,
    action: r.action,
    method: r.method,
    route: r.route,
    windowStart: asDate(r.window_start),
    count: Number(r.denial_count),
    firstDeniedAt: asDate(r.first_denied_at),
    lastDeniedAt: asDate(r.last_denied_at),
    correlationId: r.correlation_id,
  };
}

function asDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}
