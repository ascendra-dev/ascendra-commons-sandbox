export type {
  NotificationRecipient,
  NotificationRequest,
  NotificationChannel,
  NotificationChannelResult,
  NotificationResult,
  CredentialCheck,
} from './notification.types';

export type { NotificationConfig, NotificationConfigData, ProviderConfig } from './notification-config.port';

export type { NotificationTemplate } from './notification-template';
export { escapeHtml, renderTemplate } from './notification-template';
export type { NotificationTypeDefinition, NotificationVariableDefinition } from './notification-type';
export { sampleVariables, templateVariables } from './notification-type';
export { NOTIFICATION_CHANNELS } from './notification.types';
export { NotificationRecipientHasher, recipientKey } from './recipient-hasher';
export type { NotificationSuppressionList } from './notification-suppression.port';
export type { DedupeClaim, NotificationDeduplicator } from './notification-deduplicator.port';
export type { NotificationPreferences } from './notification-preferences.port';

export type { NotificationSender } from './notification-sender.port';
export { EmailNotificationSender } from './email-notification-sender';
export { WhatsappNotificationSender } from './whatsapp-notification-sender';
export { SMSNotificationSender } from './sms-notification-sender';
export { InAppNotificationSender } from './in-app-notification-sender';
export type { InboxItemInput, NotificationInbox } from './notification-inbox.port';

export type { UserContact, UserContactResolver } from './user-contact-resolver';
export { NullUserContactResolver } from './user-contact-resolver';

export { Notifier, NotificationDeliveryError } from './notifier';

export type {
  NotificationDeliveryRecorder,
  DeliveryAttempt,
  DeliveryStatusUpdate,
  DeliveryContent,
} from './notification-delivery-recorder.port';
export { NoopNotificationDeliveryRecorder } from './noop-notification-delivery-recorder';

export { NotificationModule } from './notification.module';
export type { NotificationModuleConfig } from './notification.module';

export {
  NOTIFICATION_CONFIG,
  USER_CONTACT_RESOLVER,
  NOTIFICATION_CHANNEL_SENDERS,
  NOTIFIER,
  NOTIFICATION_DELIVERY_RECORDER,
  NOTIFICATION_TYPES,
  NOTIFICATION_RECIPIENT_HASHER,
  NOTIFICATION_SUPPRESSION_LIST,
  NOTIFICATION_DEDUPLICATOR,
  NOTIFICATION_PREFERENCES,
  NOTIFICATION_INBOX,
} from './tokens';
