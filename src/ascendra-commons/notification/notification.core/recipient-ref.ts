import type { NotificationRecipient } from './notification.types';

/**
 * A recipient as the delivery log and the stub senders' logs name it — `user:<id>` for a known user, `raw:email` /
 * `raw:phone` / `raw` for a raw one. Never the address itself, so neither is a store of personal data.
 */
export function recipientRef(recipient: NotificationRecipient): string {
  if (recipient.type === 'user') return `user:${recipient.id}`;
  if (recipient.email) return 'raw:email';
  if (recipient.phone) return 'raw:phone';
  return 'raw';
}
