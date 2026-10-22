/** Injection tokens for `background-jobs.api`. Symbols, not string literals. */

/** Optional `JobAuditEmitter` — bound by the consumer to record manual triggers, or left as the no-op. */
export const JOB_AUDIT_EMITTER = Symbol('JOB_AUDIT_EMITTER');

/** Optional `() => string | undefined` — the app's ambient correlation id, for a manual run sent without a header. */
export const JOB_CORRELATION_ID_RESOLVER = Symbol('JOB_CORRELATION_ID_RESOLVER');
