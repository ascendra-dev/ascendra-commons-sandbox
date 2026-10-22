import type { SQL } from 'drizzle-orm';

/**
 * The minimal shape the Postgres/Drizzle adapter needs from the consumer's
 * database client — deliberately not the consumer's full schema-typed Drizzle
 * client, so this adapter never depends on any project's generated schema. The
 * same reasoning the `background-jobs/` core's own `SqlExecutor` uses;
 * duplicated here rather than imported, so a consumer that deletes the
 * `adapters/` folder for a different stack takes this file with it.
 *
 * Any Drizzle pg database — `NodePgDatabase`, `PostgresJsDatabase`, a Supabase
 * pooled client wrapped the same way — satisfies this structurally.
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}
