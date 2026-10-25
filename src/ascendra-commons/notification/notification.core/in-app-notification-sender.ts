import { Inject, Injectable, Optional } from '@nestjs/common';
import { NotificationChannelResult, NotificationRequest } from './notification.types';
import { NotificationConfig } from './notification-config.port';
import { NotificationSender } from './notification-sender.port';
import { renderTemplate } from './notification-template';
import type { NotificationInbox } from './notification-inbox.port';
import { NOTIFICATION_CONFIG, NOTIFICATION_INBOX } from './tokens';

/**
 * The `in_app` channel — not a stub: it renders the type's `in_app` template (its `subject` is the title) into the
 * user's inbox through `NotificationInbox`. A user recipient only: a guest has no account to read it in. Needs no
 * provider credential — the app is the provider.
 */
@Injectable()
export class InAppNotificationSender implements NotificationSender {
  constructor(
    @Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig,
    @Optional() @Inject(NOTIFICATION_INBOX) private readonly inbox: NotificationInbox | null = null,
  ) {}

  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    if (request.recipient.type !== 'user') return { status: 'failed', reason: 'no_user_recipient' };
    if (!this.inbox) return { status: 'failed', reason: 'no_inbox' };

    const template = await this.config.templateFor('in_app', request.notificationType, request.tenantId ?? null);
    if (!template) return { status: 'failed', reason: 'template_not_found' };

    const rendered = renderTemplate(template, request.variables);
    const id = await this.inbox.deliver({
      userId: request.recipient.id,
      tenantId: request.tenantId ?? null,
      notificationType: request.notificationType,
      title: rendered.subject ?? null,
      body: rendered.body,
      correlationId: request.correlationId,
    });
    return { status: 'sent', providerMessageId: `inbox:${id}`, rendered };
  }
}
