import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannelResult, NotificationRecipient, NotificationRequest } from './notification.types';
import { NotificationConfig } from './notification-config.port';
import { NotificationSender } from './notification-sender.port';
import { renderTemplate } from './notification-template';
import { logStubSend } from './stub-log';
import { UserContactResolver } from './user-contact-resolver';
import { NOTIFICATION_CONFIG, USER_CONTACT_RESOLVER } from './tokens';

@Injectable()
export class SMSNotificationSender implements NotificationSender {
  constructor(
    @Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig,
    @Inject(USER_CONTACT_RESOLVER) private readonly users: UserContactResolver,
  ) {}

  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    const to = await this.resolvePhone(request.recipient);
    if (!to) return { status: 'failed', reason: 'no_address_available' };

    const provider = await this.config.providerConfigFor('sms', request.tenantId ?? null);
    if (!provider) return { status: 'failed', reason: 'no_provider_config' };

    const template = await this.config.templateFor('sms', request.notificationType, request.tenantId ?? null);
    if (!template) return { status: 'failed', reason: 'template_not_found' };

    const rendered = renderTemplate(template, request.variables);
    // Stub: no real send — a line saying one would have gone out, without the number or the text.
    logStubSend('sms', request);
    return { status: 'sent', rendered };
  }

  private async resolvePhone(recipient: NotificationRecipient): Promise<string | null> {
    if (recipient.type === 'raw') return recipient.phone ?? null;
    const user = await this.users.findById(recipient.id);
    return user?.phone ?? null;
  }
}
