/**
 * Injection tokens for the Postgres/Drizzle adapter. Symbols, not string
 * literals. The read port is bound under `AUDIT_EVENT_READER` (from
 * `audit-logging.core`), not an adapter-specific token.
 */

/** Bound to the consumer's Drizzle db via `PostgresAuditPersistenceModule.forRoot({ sqlExecutorToken })` / `PostgresAuditObservabilityModule.forRoot(...)`. */
export const AUDIT_SQL_EXECUTOR = Symbol('AUDIT_SQL_EXECUTOR');

/**
 * The `application` string from `forRoot()` — stamped into every audit row's
 * `application` column, and filtered on by the reader. A plain value provided
 * inside this adapter's own module, not `domain-events`' `DOMAIN_EVENTS_APPLICATION_ID`.
 * Module-prefixed (`AUDIT_`) so it never collides with another module's application token.
 */
export const AUDIT_APPLICATION_ID = Symbol('AUDIT_APPLICATION_ID');

/**
 * What `PostgresAuditPersistenceModule` exports — pass this as
 * `AuditLoggingModule.forRoot({ auditEventRepositoryToken })`, with the
 * persistence module in that same call's `imports`.
 */
export const POSTGRES_AUDIT_EVENT_REPOSITORY = Symbol('POSTGRES_AUDIT_EVENT_REPOSITORY');
