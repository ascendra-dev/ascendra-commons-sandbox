/**
 * Injection tokens for the database (Model 2) family. Symbols, not string
 * literals. A stack adapter binds its admin/observability implementations under
 * these; `notification.api` consumes them.
 */

/** A stack adapter's `NotificationObservabilityPort` implementation — delivery history + config-coverage gaps. */
export const NOTIFICATION_OBSERVABILITY_PORT = Symbol('NOTIFICATION_OBSERVABILITY_PORT');

/** A stack adapter's `NotificationConfigAdminPort` implementation — CRUD on routes / templates / credentials. */
export const NOTIFICATION_CONFIG_ADMIN_PORT = Symbol('NOTIFICATION_CONFIG_ADMIN_PORT');

/** A user's preference rules — `NotificationPreferenceStore`, bound by a stack adapter. */
export const NOTIFICATION_PREFERENCE_STORE = Symbol('NOTIFICATION_PREFERENCE_STORE');

/** A user's in-app inbox — `NotificationInboxStore`, bound by a stack adapter. */
export const NOTIFICATION_INBOX_STORE = Symbol('NOTIFICATION_INBOX_STORE');
