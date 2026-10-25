import type { SQL } from 'drizzle-orm';

/**
 * The minimal shape this adapter needs from the consumer's database client —
 * deliberately not the consumer's full schema-typed Drizzle client. Same
 * reasoning as `background-jobs` / `idempotency-key` / the audit-logging and
 * authorization adapters; duplicated here so `notification/` stays
 * independently copyable (and a consumer that deletes `adapters/` for a
 * different stack takes this with it).
 */
export interface SqlExecutor {
  execute<T = Record<string, unknown>>(query: SQL): Promise<{ rows: T[] }>;
}
