/** Injection tokens for `notification.api`. Symbols, not string literals. */

/** `NotificationApiOptions` — the platform-admin predicate. Bound by `NotificationApiModule.forRoot()`. */
export const NOTIFICATION_API_OPTIONS = Symbol('NOTIFICATION_API_OPTIONS');

/** Optional `NotificationAuditEmitter` — bound by the consumer to record config mutations, or left as the no-op. */
export const NOTIFICATION_AUDIT_EMITTER = Symbol('NOTIFICATION_AUDIT_EMITTER');

/** The app's `NotificationTenantDirectory`, when it binds one (`forRoot({ tenantDirectoryToken })`). */
export const NOTIFICATION_TENANT_DIRECTORY = Symbol('NOTIFICATION_TENANT_DIRECTORY');
