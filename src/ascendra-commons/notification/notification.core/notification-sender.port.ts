import { NotificationChannelResult, NotificationRequest } from './notification.types';
import type { ProviderConfig } from './notification-config.port';

/**
 * An interface — Email/WhatsApp/SMS share no behavior with each other, so
 * there's no shared base worth having; each implements this shape
 * independently. send() returns NotificationChannelResult, never the full
 * NotificationResult: a single channel's own outcome is always binary, and
 * 'partial' only ever means something once more than one channel's result
 * has been combined, which is Notifier's job, not this one's.
 *
 * The three shipped implementations (`EmailNotificationSender` etc.) are stubs
 * that render + log. A real provider integration is a per-channel future
 * package (`notification.<channel>.<provider>`) — swapping one in is a binding
 * change, never a change to `Notifier`, `NotificationConfig`, or templates.
 */
export interface NotificationSender {
  send(request: NotificationRequest): Promise<NotificationChannelResult>;
  /**
   * Optional — does this credential work? A lightweight call to the provider ("SES: sender verified", "Twilio: 401").
   * Without it, a wrong key only shows on a real send's failure. `Notifier.verifyCredential` calls it.
   */
  verify?(config: ProviderConfig): Promise<{ ok: boolean; detail?: string }>;
}
