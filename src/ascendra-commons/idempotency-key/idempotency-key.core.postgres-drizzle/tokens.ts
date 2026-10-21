/**
 * Injection tokens for the Postgres/Drizzle adapter. Symbols, not string
 * literals. Module-prefixed (`IDEMPOTENCY_`) so they don't collide with the
 * core's tokens or another module's.
 */

/** The consumer's Drizzle db, aliased in via `PostgresIdempotencyStoreModule.forRoot({ sqlExecutorToken })`. */
export const IDEMPOTENCY_SQL_EXECUTOR = Symbol('IDEMPOTENCY_SQL_EXECUTOR');

/** `{ staleAfterSeconds }` — from `PostgresIdempotencyStoreModule.forRoot()`. See `IdempotencyStoreOptions`. */
export const IDEMPOTENCY_STORE_OPTIONS = Symbol('IDEMPOTENCY_STORE_OPTIONS');

/** `PostgresIdempotencyDuplicateCounterOptions` — from `PostgresIdempotencyStoreModule.forRoot({ duplicateCounter })`. */
export const IDEMPOTENCY_DUPLICATE_COUNTER_OPTIONS = Symbol('IDEMPOTENCY_DUPLICATE_COUNTER_OPTIONS');

/**
 * What `PostgresIdempotencyStoreModule` exports as its `IdempotencyStore`
 * implementation. Pass it to `IdempotencyModule.forRoot({ storeToken: POSTGRES_IDEMPOTENCY_STORE })`.
 */
export const POSTGRES_IDEMPOTENCY_STORE = Symbol('POSTGRES_IDEMPOTENCY_STORE');
