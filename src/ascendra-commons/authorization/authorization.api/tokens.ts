/** Injection tokens for `authorization.api`. Symbols, not string literals. */

/** `AuthzApiOptions` — resolved action names, the action catalog, the platform-admin predicate. Bound by `AuthorizationApiModule.forRoot()`. */
export const AUTHZ_API_OPTIONS = Symbol('AUTHZ_API_OPTIONS');

/** Optional `AuthzAuditEmitter` — bound by the consumer to record mutations, or left as the no-op. */
export const AUTHZ_AUDIT_EMITTER = Symbol('AUTHZ_AUDIT_EMITTER');

/** The app's `AuthzUserDirectory` — who its users are. Optional: without it the people endpoints answer 501. */
export const AUTHZ_USER_DIRECTORY = Symbol('AUTHZ_USER_DIRECTORY');
