/**
 * Injection tokens for the Postgres/Drizzle notification adapter. Symbols, not
 * string literals.
 *
 * The family tokens (`NOTIFICATION_OBSERVABILITY_PORT`,
 * `NOTIFICATION_CONFIG_ADMIN_PORT`) come from `notification.core.database`; the
 * config token `POSTGRES_NOTIFICATION_CONFIG` and delivery-recorder token
 * `POSTGRES_NOTIFICATION_DELIVERY_RECORDER` are passed to
 * `NotificationModule.forRoot({ configToken, deliveryRecorderToken })`.
 */

// --- config reader ---
export const NOTIFICATION_CONFIG_SQL_EXECUTOR = Symbol('NOTIFICATION_CONFIG_SQL_EXECUTOR');
export const NOTIFICATION_CONFIG_OPTIONS = Symbol('NOTIFICATION_CONFIG_OPTIONS');
export const POSTGRES_NOTIFICATION_CONFIG = Symbol('POSTGRES_NOTIFICATION_CONFIG');

// --- delivery log + admin (shared db + application) ---
export const NOTIFICATION_ADMIN_SQL_EXECUTOR = Symbol('NOTIFICATION_ADMIN_SQL_EXECUTOR');
export const NOTIFICATION_ADMIN_APPLICATION_ID = Symbol('NOTIFICATION_ADMIN_APPLICATION_ID');

/** What `PostgresNotificationInboxModule` exports — pass it as `NotificationModule.forRoot({ inboxToken })`. */
export const POSTGRES_NOTIFICATION_INBOX = Symbol('POSTGRES_NOTIFICATION_INBOX');

/** What `PostgresNotificationPreferencesModule` exports — pass it as `NotificationModule.forRoot({ preferencesToken })`. */
export const POSTGRES_NOTIFICATION_PREFERENCES = Symbol('POSTGRES_NOTIFICATION_PREFERENCES');

/** What `PostgresNotificationDedupeModule` exports — pass it as `NotificationModule.forRoot({ deduplicatorToken })`. */
export const POSTGRES_NOTIFICATION_DEDUPLICATOR = Symbol('POSTGRES_NOTIFICATION_DEDUPLICATOR');

/** The suppression list's lookup cache. */
export const NOTIFICATION_SUPPRESSION_OPTIONS = Symbol('NOTIFICATION_SUPPRESSION_OPTIONS');

/** What `PostgresNotificationSuppressionModule` exports — pass it as `NotificationModule.forRoot({ suppressionListToken })`. */
export const POSTGRES_NOTIFICATION_SUPPRESSION_LIST = Symbol('POSTGRES_NOTIFICATION_SUPPRESSION_LIST');

/** The buffered delivery recorder's flush interval and buffer bound. */
export const NOTIFICATION_DELIVERY_RECORDER_OPTIONS = Symbol('NOTIFICATION_DELIVERY_RECORDER_OPTIONS');

/** Whether a tenant with no credential falls back to the platform's — so coverage gaps agree with the config reader. */
export const NOTIFICATION_ADMIN_CREDENTIAL_FALLBACK = Symbol('NOTIFICATION_ADMIN_CREDENTIAL_FALLBACK');
export const NOTIFICATION_ADMIN_STORE_CONTENT = Symbol('NOTIFICATION_ADMIN_STORE_CONTENT');
export const POSTGRES_NOTIFICATION_DELIVERY_RECORDER = Symbol('POSTGRES_NOTIFICATION_DELIVERY_RECORDER');
