import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidIdempotencyCursorError,
  type CachedResponse,
  type ClaimHealthQuery,
  type ClaimHealthSummary,
  type ClaimPage,
  type ClaimQuery,
  type IdempotencyClaimRecord,
  type IdempotencyObservabilityPort,
  type RouteClaimCount,
} from '../../idempotency-key.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { IDEMPOTENCY_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Every column `mapRow` reads. Not `response_body` — only its size; the body is `getClaimResponse`'s alone. Not
 * `claim_id`, the owner's token, which never leaves the store.
 */
const CLAIM_COLUMNS = sql.raw(
  'key, scope, status, status_code, octet_length(response_body::text) as response_bytes, created_at, reclaim_count, ' +
    'late_complete_no_op_count, replay_count, conflict_count, last_duplicate_at, route, correlation_id',
);

/**
 * Reference `IdempotencyObservabilityPort` for Postgres — one library-owned
 * `SELECT` with a dynamic `WHERE`, keyset-paginated newest-first, plus one
 * aggregate query for `claimHealthSummary()`. Read-only — no
 * `INSERT`/`UPDATE`/`DELETE` path exists here; writes stay
 * `PostgresIdempotencyStore`'s alone.
 *
 * No `application` scoping — the module's own stance (see `idempotency-key`'s
 * README) is that a claim never leaves the store, and that isn't changed by
 * adding a read path over it.
 */
@Injectable()
export class PostgresIdempotencyObservabilityService implements IdempotencyObservabilityPort {
  constructor(@Inject(IDEMPOTENCY_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async getClaim(key: string, scope: string): Promise<IdempotencyClaimRecord | null> {
    const { rows } = await this.db.execute(sql`
      select ${CLAIM_COLUMNS}
      from commons_idempotency_key
      where key = ${key} and scope = ${scope}
    `);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async getClaimResponse(key: string, scope: string): Promise<CachedResponse | null> {
    const { rows } = await this.db.execute(sql`
      select status_code, response_body
      from commons_idempotency_key
      where key = ${key} and scope = ${scope} and status = 'completed'
    `);
    const row = rows[0];
    return row ? { statusCode: Number(row.status_code), body: row.response_body } : null;
  }

  async listClaims(query: ClaimQuery = {}): Promise<ClaimPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const conds: SQL[] = [];
    if (query.status !== undefined) conds.push(sql`status = ${query.status}`);
    if (query.scope !== undefined) conds.push(sql`scope = ${query.scope}`);
    if (query.route !== undefined) conds.push(sql`route = ${query.route}`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`created_at >= ${query.since}`);
    if (query.until) conds.push(sql`created_at < ${query.until}`);

    const cursor = query.cursor ? decodeKeysetCursor(query.cursor) : null;
    // A cursor that doesn't decode was never issued here — silently starting from the top would repeat page one.
    if (query.cursor && !cursor) throw new InvalidIdempotencyCursorError(`Unrecognized cursor "${query.cursor}"`);
    if (cursor) {
      conds.push(
        sql`(created_at < ${cursor.timestamp}
          or (created_at = ${cursor.timestamp} and (key, scope) < (${cursor.key}, ${cursor.scope})))`,
      );
    }

    const where = conds.length > 0 ? sql`where ${sql.join(conds, sql` and `)}` : sql``;

    const rows = (
      await this.db.execute(sql`
        select ${CLAIM_COLUMNS}
        from commons_idempotency_key
        ${where}
        order by created_at desc, key desc, scope desc
        limit ${limit + 1}
      `)
    ).rows.map(mapRow);

    if (rows.length > limit) {
      const claims = rows.slice(0, limit);
      const last = claims[claims.length - 1];
      return { claims, nextCursor: encodeKeysetCursor(last.createdAt, last.key, last.scope) };
    }
    return { claims: rows };
  }

  async claimHealthSummary(query: ClaimHealthQuery = {}): Promise<ClaimHealthSummary> {
    // "Oldest retained" is the whole table's, whatever the period — how far back any period can actually look.
    const { rows } = await this.db.execute(sql`
      select
        count(*) filter (where status = 'pending') as pending_count,
        count(*) filter (where status = 'completed') as completed_count,
        count(*) filter (where reclaim_count > 0) as reclaimed_count,
        coalesce(sum(late_complete_no_op_count), 0) as late_complete_no_op_total,
        coalesce(sum(replay_count), 0) as replay_total,
        coalesce(sum(conflict_count), 0) as conflict_total,
        count(*) as total_count,
        (select min(created_at) from commons_idempotency_key) as oldest_retained_at
      from commons_idempotency_key
      ${sinceWhere(query.since)}
    `);
    const row = rows[0] ?? {};
    return {
      pendingCount: Number(row.pending_count ?? 0),
      completedCount: Number(row.completed_count ?? 0),
      reclaimedCount: Number(row.reclaimed_count ?? 0),
      lateCompleteNoOpTotal: Number(row.late_complete_no_op_total ?? 0),
      replayTotal: Number(row.replay_total ?? 0),
      conflictTotal: Number(row.conflict_total ?? 0),
      totalCount: Number(row.total_count ?? 0),
      oldestRetainedAt: toDateOrNull(row.oldest_retained_at),
    };
  }

  async claimsByRoute(query: ClaimHealthQuery = {}): Promise<RouteClaimCount[]> {
    const { rows } = await this.db.execute(sql`
      select
        route,
        count(*) as claims,
        coalesce(sum(replay_count), 0) as replays,
        coalesce(sum(conflict_count), 0) as conflicts,
        count(*) filter (where reclaim_count > 0) as reclaimed,
        coalesce(sum(late_complete_no_op_count), 0) as late_complete_no_ops
      from commons_idempotency_key
      ${sinceWhere(query.since)}
      group by route
      order by sum(replay_count) + sum(conflict_count) desc, count(*) desc, route
    `);
    return rows.map((row) => ({
      route: row.route == null ? null : String(row.route),
      claims: Number(row.claims),
      replays: Number(row.replays),
      conflicts: Number(row.conflicts),
      reclaimed: Number(row.reclaimed),
      lateCompleteNoOps: Number(row.late_complete_no_ops),
    }));
  }
}

function sinceWhere(since: Date | undefined): SQL {
  return since ? sql`where created_at >= ${since}` : sql``;
}

function toDateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function mapRow(row: Record<string, unknown>): IdempotencyClaimRecord {
  const completed = row.status === 'completed';
  return {
    key: String(row.key),
    scope: String(row.scope),
    status: row.status as IdempotencyClaimRecord['status'],
    statusCode: completed && row.status_code != null ? Number(row.status_code) : null,
    responseBytes: completed && row.response_bytes != null ? Number(row.response_bytes) : null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    reclaimCount: Number(row.reclaim_count),
    lateCompleteNoOpCount: Number(row.late_complete_no_op_count),
    replayCount: Number(row.replay_count ?? 0),
    conflictCount: Number(row.conflict_count ?? 0),
    lastDuplicateAt: toDateOrNull(row.last_duplicate_at),
    route: row.route == null ? null : String(row.route),
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
  };
}
