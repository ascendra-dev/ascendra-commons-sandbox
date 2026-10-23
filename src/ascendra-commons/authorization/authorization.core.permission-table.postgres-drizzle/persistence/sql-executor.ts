import type { SQL } from 'drizzle-orm';

/**
 * The minimal shape this adapter needs from the consumer's database client —
 * deliberately not the consumer's full schema-typed Drizzle client, so the
 * adapter never depends on any project's generated schema. Same reasoning as
 * `background-jobs` / `idempotency-key` / the audit-logging adapter; duplicated
 * here rather than imported so the adapter stays independently copyable.
 *
 * Any Drizzle pg database — `NodePgDatabase`, `PostgresJsDatabase`, a Supabase
 * pooled client wrapped the same way — satisfies this structurally.
 */
export interface SqlExecutor {
  execute<T = Record<string, unknown>>(query: SQL): Promise<{ rows: T[] }>;
}
