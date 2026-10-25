import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannelResult, NotificationRequest } from './notification.types';
import { NotificationConfig } from './notification-config.port';
import { NotificationSender } from './notification-sender.port';
import { NOTIFICATION_CONFIG } from './tokens';
import { logStubSend } from './stub-log';

/**
 * No template rendering yet — WhatsApp's real templates are pre-approved and
 * named on Meta's side with positional numbered parameters, not free-form
 * `{{variable}}` text this library renders. That's a distinct shape for a
 * later piece; this stays a stub until it's built. Provider config is resolved
 * now regardless — the credential-per-tenant seam doesn't depend on the
 * template shape being settled first.
 */
@Injectable()
export class WhatsappNotificationSender implements NotificationSender {
  constructor(@Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig) {}

  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    const provider = await this.config.providerConfigFor('whatsapp', request.tenantId ?? null);
    if (!provider) return { status: 'failed', reason: 'no_provider_config' };

    // Stub: no real send — a line saying one would have gone out, without the number or the variables.
    logStubSend('whatsapp', request);
    return { status: 'sent' };
  }
}
