import { createHmac } from 'node:crypto';
import type { NotificationChannel, NotificationRecipient } from './notification.types';
import { recipientRef } from './recipient-ref';

/**
 * A keyed hash of a recipient's address — so the delivery log can find "everything sent to ada@example.com" without
 * storing the address. HMAC-SHA256 with the app's secret (`NotificationModule.forRoot({ recipientHashKey })`): without
 * the key, a leaked log can't be matched against a list of addresses. The address is normalized first — an email
 * lowercased and trimmed, a phone number reduced to its digits — so the same person hashes the same.
 */
export class NotificationRecipientHasher {
  constructor(private readonly key: string) {
    if (!key || key.length < 16) throw new Error('recipientHashKey must be at least 16 characters — a secret, not a label');
  }

  hashEmail(email: string): string {
    return this.hash(`email:${email.trim().toLowerCase()}`);
  }

  hashPhone(phone: string): string {
    return this.hash(`phone:${phone.replace(/\D/g, '')}`);
  }

  private hash(value: string): string {
    return `h:${createHmac('sha256', this.key).update(value).digest('base64url')}`;
  }
}

/**
 * How a recipient is keyed on one channel — what the delivery log searches by and a suppression is filed under. A
 * user is `user:<id>`; a raw recipient is the hash of the address that channel uses (email for email, the phone for
 * SMS / WhatsApp) — or `null` when there's no hasher (or no such address), and then it can't be searched or suppressed.
 */
export function recipientKey(
  channel: NotificationChannel,
  recipient: NotificationRecipient,
  hasher: NotificationRecipientHasher | null,
): string | null {
  if (recipient.type === 'user') return recipientRef(recipient);
  if (!hasher) return null;
  if (channel === 'email') return recipient.email ? hasher.hashEmail(recipient.email) : null;
  return recipient.phone ? hasher.hashPhone(recipient.phone) : null;
}
