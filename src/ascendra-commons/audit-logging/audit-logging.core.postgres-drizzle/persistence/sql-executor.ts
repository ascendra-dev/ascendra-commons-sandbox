import type { SQL } from 'drizzle-orm';

/**
 * The minimal shape `PostgresAuditEventRepository` needs from the consumer's
 * database client — deliberately not the consumer's full schema-typed Drizzle
 * client, so this adapter never depends on any project's generated schema. The
 * same reasoning `background-jobs`' and `idempotency-key`' own `SqlExecutor`
 * use; duplicated here rather than imported, so `audit-logging/` stays
 * independently copyable (and so a consumer that deletes the `adapters/`
 * folder for a different stack takes this with it).
 *
 * Any Drizzle pg database — `NodePgDatabase`, `PostgresJsDatabase`, a Supabase
 * pooled client wrapped the same way — satisfies this structurally.
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}
