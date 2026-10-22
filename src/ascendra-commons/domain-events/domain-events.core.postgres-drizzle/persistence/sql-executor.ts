import type { SQL } from 'drizzle-orm';

/**
 * The minimal shape this adapter needs from the consumer's database client —
 * deliberately not the consumer's full schema-typed Drizzle client, so this
 * adapter never depends on any project's generated schema. The same reasoning
 * every other Postgres/Drizzle adapter in this library duplicates its own copy
 * of this interface for; kept here too rather than imported, so
 * `domain-events/` stays independently copyable.
 *
 * Any Drizzle pg database — `NodePgDatabase`, `PostgresJsDatabase`, a Supabase
 * pooled client wrapped the same way — satisfies this structurally.
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}
