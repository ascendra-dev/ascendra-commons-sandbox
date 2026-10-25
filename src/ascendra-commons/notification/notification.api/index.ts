export { NotificationApiModule } from './notification-api.module';
export type { NotificationApiModuleConfig } from './notification-api.options';
export { NOTIFICATION_ACTIONS } from './notification-api.options';

export type { NotificationAuditEmitter, NotificationAuditEvent } from './notification-audit.port';
export { NoopNotificationAuditEmitter } from './notification-audit.port';
export type { NotificationTenantDirectory } from './notification-tenant-directory.port';
export { NOTIFICATION_AUDIT_EMITTER, NOTIFICATION_API_OPTIONS, NOTIFICATION_TENANT_DIRECTORY } from './tokens';
export type { NotificationTypeSummary, NotificationTypeDetail } from './types/notification-types-api.service';
export type { MyPreferences } from './preferences/notification-preferences-api.service';
export type { DeliveryView } from './observability/notification-observability-api.service';
export type { SuppressionEntry } from './suppressions/notification-suppressions-api.service';

export type {
  DeliveryHistoryQueryDto,
  DeliveryStatsQueryDto,
  PreviewTemplateBody,
  SetChannelRouteBody,
  SetTemplateBody,
  SetProviderCredentialBody,
  TestSendBody,
} from './dto/notification-api.dto';
