import { Logger } from '@nestjs/common';
import type { NotificationChannel, NotificationRequest } from './notification.types';
import { recipientRef } from './recipient-ref';

const logger = new Logger('NotificationStub');

/**
 * What a stub sender logs in place of a real send: the channel, the type, the tenant and the redacted recipient. Not
 * the address, the rendered text or the variables — they're personal data, and a log isn't where it goes. (Nor the
 * provider config: it may hold secrets.)
 */
export function logStubSend(channel: NotificationChannel, request: NotificationRequest): void {
  logger.log(
    `[stub] ${channel} · ${request.notificationType} · tenant ${request.tenantId ?? '(none)'} · to ${recipientRef(request.recipient)}${request.test ? ' · test' : ''}`,
  );
}
