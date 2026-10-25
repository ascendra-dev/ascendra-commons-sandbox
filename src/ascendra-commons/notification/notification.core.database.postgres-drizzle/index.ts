// Schema — tables for typed queries; never re-export them to drizzle-kit (the DDL is migrations/)
export {
  notificationChannelRoute,
  notificationTemplate,
  notificationProviderCredential,
} from './persistence/config.schema';
export { notificationDelivery } from './persistence/delivery.schema';
export { notificationSuppression } from './persistence/suppression.schema';
export { notificationDedupe } from './persistence/dedupe.schema';
export { notificationPreference } from './persistence/preference.schema';
export { notificationInbox } from './persistence/inbox.schema';
export type { SqlExecutor } from './persistence/sql-executor';

// Seed — behaviour-preserving model: 'static' -> database
export { seedNotificationConfigFromData } from './seed/seed-from-static-data';

// Config reader (Model 2 NotificationConfig)
export { PostgresNotificationConfig } from './config/postgres-notification-config';
export type { NotificationConfigOptions } from './config/postgres-notification-config';
export { PostgresNotificationConfigModule } from './config/postgres-notification-config.module';
export type { PostgresNotificationConfigModuleConfig } from './config/postgres-notification-config.module';

// Delivery log
export { PostgresNotificationDeliveryRecorder } from './delivery-log/postgres-notification-delivery-recorder';
export { PostgresNotificationDeliveryRecorderModule } from './delivery-log/postgres-notification-delivery-recorder.module';
export type { PostgresNotificationDeliveryRecorderModuleConfig } from './delivery-log/postgres-notification-delivery-recorder.module';
export type { PostgresNotificationDeliveryRecorderOptions } from './delivery-log/postgres-notification-delivery-recorder';

// Suppression list — what Notifier asks before each send
export { PostgresNotificationSuppressionList } from './suppression/postgres-notification-suppression-list';
export type { PostgresNotificationSuppressionListOptions } from './suppression/postgres-notification-suppression-list';
export { PostgresNotificationSuppressionModule } from './suppression/postgres-notification-suppression.module';
export type { PostgresNotificationSuppressionModuleConfig } from './suppression/postgres-notification-suppression.module';

// Dedupe keys — notify({ dedupeKey }) sends once per key
export { PostgresNotificationDeduplicator } from './dedupe/postgres-notification-deduplicator';
export { PostgresNotificationDedupeModule } from './dedupe/postgres-notification-dedupe.module';
export type { PostgresNotificationDedupeModuleConfig } from './dedupe/postgres-notification-dedupe.module';

// Users' preferences — what Notifier asks, and "my preferences" edits
export { PostgresNotificationPreferences } from './preferences/postgres-notification-preferences';
export { PostgresNotificationPreferencesModule } from './preferences/postgres-notification-preferences.module';
export type { PostgresNotificationPreferencesModuleConfig } from './preferences/postgres-notification-preferences.module';

// The in-app inbox — where the in_app channel delivers, and what a user reads
export { PostgresNotificationInbox } from './inbox/postgres-notification-inbox';
export { PostgresNotificationInboxModule } from './inbox/postgres-notification-inbox.module';
export type { PostgresNotificationInboxModuleConfig } from './inbox/postgres-notification-inbox.module';

// Retention — the consumer schedules it
export { PostgresNotificationRetentionService } from './retention/postgres-notification-retention.service';
export { PostgresNotificationRetentionModule } from './retention/postgres-notification-retention.module';
export type { PostgresNotificationRetentionModuleConfig } from './retention/postgres-notification-retention.module';

// Admin surface (implements the family ports)
export { PostgresNotificationObservabilityService } from './admin/postgres-notification-observability.service';
export { PostgresNotificationConfigAdminService } from './admin/postgres-notification-config-admin.service';
export { PostgresNotificationAdminModule } from './admin/postgres-notification-admin.module';
export type { PostgresNotificationAdminModuleConfig } from './admin/postgres-notification-admin.module';

export {
  POSTGRES_NOTIFICATION_CONFIG,
  POSTGRES_NOTIFICATION_DELIVERY_RECORDER,
  POSTGRES_NOTIFICATION_SUPPRESSION_LIST,
  POSTGRES_NOTIFICATION_DEDUPLICATOR,
  POSTGRES_NOTIFICATION_PREFERENCES,
  POSTGRES_NOTIFICATION_INBOX,
  NOTIFICATION_CONFIG_SQL_EXECUTOR,
  NOTIFICATION_ADMIN_SQL_EXECUTOR,
} from './tokens';
