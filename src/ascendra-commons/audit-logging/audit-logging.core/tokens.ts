/**
 * Injection tokens. Symbols, not string literals, same reasoning as every
 * other module in this library — a typo in a binding is a compile error, not
 * a silently unbound provider.
 */

/** What `AuditListener` (shipped by this module) injects — bound to whichever `AuditEventRepository` implementation the app uses. */
export const AUDIT_EVENT_REPOSITORY = Symbol('AUDIT_EVENT_REPOSITORY');

/**
 * What an admin/observability caller injects — bound to an `AuditEventReader`
 * implementation. A stack adapter's observability module binds it (the
 * Postgres/Drizzle adapter's `PostgresAuditObservabilityModule` does);
 * `audit-logging.api` consumes it. Never touched by feature code.
 */
export const AUDIT_EVENT_READER = Symbol('AUDIT_EVENT_READER');

/**
 * The one, fixed domain-event name every `AuditRecordRaised` is emitted under —
 * a plain string, not a symbol, since domain-event names are strings by
 * convention throughout this repo. Exported so producer code gets a typo-proof
 * constant to emit against, and so `AuditListener`'s own `@OnCriticalEvent()`
 * subscribes to the same literal value — never project-specific.
 */
export const AUDIT_EVENT_NAME = 'audit.record_raised';
