import type { SQL } from 'drizzle-orm';

/**
 * The minimal shape this adapter needs from the consumer's database client —
 * deliberately not the consumer's full schema-typed Drizzle client, so this
 * adapter never depends on any project's generated schema (duplicated, not
 * imported, from every other `.postgres-drizzle` adapter's identical copy).
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}
