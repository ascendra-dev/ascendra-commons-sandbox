/**
 * Injection token for the Postgres/Drizzle adapter. Symbol, not a string literal
 * — a typo in a binding is a compile error, not a silently unbound provider.
 *
 * The family tokens (`PERMISSION_TABLE_AUTHORIZER`, `AUTHZ_DELEGATION_SERVICE`,
 * `AUTHZ_ADMIN_PORT`, `AUTHZ_OBSERVABILITY_PORT`, …) come from
 * `authorization.core.permission-table`.
 */

/** Bound to the consumer's Drizzle db via `PostgresPermissionTableModule.forRoot({ sqlExecutorToken })` / `PostgresAuthzAdminModule.forRoot(...)`. */
export const AUTHZ_SQL_EXECUTOR = Symbol('AUTHZ_SQL_EXECUTOR');

/** The denied-requests log's executor, application and options — `PostgresAccessDenial*Module`. */
export const DENIAL_SQL_EXECUTOR = Symbol('DENIAL_SQL_EXECUTOR');
export const DENIAL_APPLICATION_ID = Symbol('DENIAL_APPLICATION_ID');
export const DENIAL_RECORDER_OPTIONS = Symbol('DENIAL_RECORDER_OPTIONS');
/** `PostgresAccessDenialRecorder` — pass as `AuthorizationModule.forRoot({ denialRecorderToken })`. */
export const POSTGRES_ACCESS_DENIAL_RECORDER = Symbol('POSTGRES_ACCESS_DENIAL_RECORDER');
