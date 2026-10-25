import type { NotificationChannel } from './notification.types';

/**
 * A user's own choices — "no SMS", "no payment reminders by email". `Notifier` asks before each channel's send to a
 * `'user'` recipient and skips an opted-out one (`skipped`, reason `opted_out`) — unless the type is declared
 * `required` (a password reset, a security alert), which always sends. Optional: bound via
 * `NotificationModule.forRoot({ preferencesToken })`. A raw (guest) recipient has no account, so no preferences.
 *
 * A throw is treated as "not opted out" — a broken store mustn't stop every notification.
 */
export interface NotificationPreferences {
  isOptedOut(userId: string, notificationType: string, channel: NotificationChannel): Promise<boolean>;
}
