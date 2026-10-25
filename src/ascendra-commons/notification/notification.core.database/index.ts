// Stack-agnostic utilities
export { ConfigCache } from './config-cache';
export { calendarDays, isValidTimeZone } from './calendar-days';
export { encodeKeysetCursor, decodeKeysetCursor, isDeliveryId, InvalidDeliveryCursorError } from './keyset-cursor';

// Ports a stack adapter implements
export type { NotificationObservabilityPort } from './notification-observability.port';
export type { NotificationConfigAdminPort } from './notification-config-admin.port';

// Answer-shapes / write inputs
export type {
  DeliveryRecord,
  DeliveryContentRecord,
  DeliveryHistoryQuery,
  DeliveryHistoryPage,
  DeliveryStatsQuery,
  DeliveryStats,
  DeliveryChannelStatusCount,
  DeliveryTypeStatusCount,
  DeliveryDayCount,
  DeliveryVolume,
  DeliveryVolumeDay,
  CoverageGap,
  ConfigScope,
  SuppressionView,
  SuppressionListQuery,
  SuppressionPage,
  ChannelRouteView,
  TemplateView,
  ProviderCredentialView,
  SetChannelRouteInput,
  DeleteChannelRouteInput,
  SetTemplateInput,
  DeleteTemplateInput,
  SetProviderCredentialInput,
  DeleteProviderCredentialInput,
} from './notification-admin.types';

export { NOTIFICATION_OBSERVABILITY_PORT, NOTIFICATION_CONFIG_ADMIN_PORT, NOTIFICATION_PREFERENCE_STORE, NOTIFICATION_INBOX_STORE } from './tokens';
export type { InboxItem, InboxPage, InboxQuery, NotificationInboxStore } from './notification-inbox-store.port';
export { ANY, preferenceAllows } from './notification-preference-store.port';
export type { NotificationPreferenceStore, PreferenceRule } from './notification-preference-store.port';
