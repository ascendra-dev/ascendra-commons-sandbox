import type { SQL } from 'drizzle-orm';

/**
 * The minimal shape `PostgresIdempotencyStore` needs from the consumer's
 * database client — deliberately not the consumer's full schema-typed Drizzle
 * client, so this adapter never depends on any project's generated schema.
 * `{ rows }` only (aligned with the other adapters' `SqlExecutor`) — the claim
 * always uses `RETURNING`, so `rows.length` is the portable "did I win" check;
 * `rowCount` is not reliably populated across `pg` vs `postgres.js` for
 * `ON CONFLICT` statements.
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}
