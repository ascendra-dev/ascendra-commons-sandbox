import type { NotificationChannel } from './notification.types';

/**
 * Recipients a channel must stop sending to — a hard bounce, a spam complaint — filed by recipient key (`user:<id>`,
 * or the keyed hash of an address; see `recipientKey`). `Notifier` asks before each channel's send and skips a
 * suppressed one (`skipped`, reason `suppressed`) — a dead address isn't hammered on every send, and the sender's
 * reputation with the provider survives. Optional: bound via `NotificationModule.forRoot({ suppressionListToken })`;
 * filled by `updateDeliveryStatus({ suppress: true })` from a provider webhook.
 *
 * Must not throw — or rather, a throw is treated as "not suppressed": a broken list mustn't stop every notification.
 */
export interface NotificationSuppressionList {
  isSuppressed(channel: NotificationChannel, recipientKey: string): Promise<boolean>;
}
