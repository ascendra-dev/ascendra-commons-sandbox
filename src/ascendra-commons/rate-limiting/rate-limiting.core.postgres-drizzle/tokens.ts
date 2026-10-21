/** Injection tokens for the Postgres/Drizzle adapter. Symbols, not string literals. */

/** The consumer's Drizzle db, aliased via `PostgresRateLimitEventRecorderModule.forRoot({ sqlExecutorToken })` / `PostgresRateLimitObservabilityModule.forRoot(...)`. */
export const RATE_LIMIT_SQL_EXECUTOR = Symbol('RATE_LIMIT_SQL_EXECUTOR');

/** Which Ascendra application this process is — stamped on every row, filtered on by every read. */
export const RATE_LIMIT_APPLICATION_ID = Symbol('RATE_LIMIT_APPLICATION_ID');

/** What `PostgresRateLimitEventRecorderModule` exports — pass this as `RateLimitingThrottlerModule.forRoot({ recorderToken })`. */
export const POSTGRES_RATE_LIMIT_EVENT_RECORDER = Symbol('POSTGRES_RATE_LIMIT_EVENT_RECORDER');

/** `PostgresRateLimitEventRecorderModule.forRoot()`'s flush/buffer options — optional; defaults apply when unbound. */
export const RATE_LIMIT_RECORDER_OPTIONS = Symbol('RATE_LIMIT_RECORDER_OPTIONS');
