import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import { NOTIFIER, type Notifier, type NotificationResult } from '../../notification.core';
import { NOTIFICATION_OBSERVABILITY_PORT, type NotificationObservabilityPort } from '../../notification.core.database';
import { NOTIFICATION_API_OPTIONS, NOTIFICATION_AUDIT_EMITTER } from '../tokens';
import type { NotificationApiOptions } from '../notification-api.options';
import type { NotificationAuditEmitter } from '../notification-audit.port';

/**
 * `POST /notifications/deliveries/:id/retry` — resend a failed delivery to its real recipient, on its channel only,
 * through Notifier (so preferences and the suppression list still apply). Possible when the row names a user (a
 * guest's address isn't stored) and its variables were stored (`storeContent`). The new rows link back (`retryOf`);
 * the retry is audited. Once only — a retried row points at its retry (`retriedBy`), which is retried instead.
 * Tenant-scoped like the row.
 */
@Injectable()
export class NotificationRetryApiService {
  constructor(
    @Inject(NOTIFICATION_OBSERVABILITY_PORT) private readonly port: NotificationObservabilityPort,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(NOTIFICATION_API_OPTIONS) private readonly options: NotificationApiOptions,
    @Inject(NOTIFICATION_AUDIT_EMITTER) private readonly audit: NotificationAuditEmitter,
  ) {}

  async retry(actor: Actor, id: string): Promise<NotificationResult> {
    const delivery = await this.port.getDelivery(id);
    if (!delivery || (!(await this.options.isPlatformAdmin(actor)) && delivery.tenantId !== actor.tenantId)) {
      throw new NotFoundException('no such delivery');
    }
    if (delivery.status !== 'failed' && delivery.status !== 'bounced') {
      throw new BadRequestException(`only a failed or bounced delivery can be retried — this one is ${delivery.status}`);
    }
    if (delivery.retriedBy) {
      throw new BadRequestException(`already retried — delivery ${delivery.retriedBy}; retry that one if it failed too`);
    }
    if (delivery.isTest) throw new BadRequestException('a test send is not retried — send another test');
    if (!delivery.recipientRef.startsWith('user:')) {
      throw new BadRequestException("a guest's address isn't stored, so it can't be resent — notify them again from where they were notified");
    }
    const stored = await this.port.getDeliveryContent(id);
    if (!stored) {
      throw new BadRequestException("the message's variables weren't stored (storeContent is off) — it can't be rebuilt");
    }

    const result = await this.notifier.notify({
      recipient: { type: 'user', id: delivery.recipientRef.slice('user:'.length) },
      notificationType: delivery.notificationType,
      variables: stored.content.variables,
      tenantId: delivery.tenantId,
      channels: [delivery.channel],
      retryOf: delivery.id,
      correlationId: delivery.correlationId ?? undefined,
    });
    // Written now, not at a buffered recorder's next flush: the retried row names its retry (retriedBy) at once — on
    // the screen, and to a second retry, which is refused instead of resending.
    await this.notifier.flushDeliveryLog();
    await this.audit.record({
      action: 'notification.delivery_retried',
      actorId: actor.id,
      tenantId: delivery.tenantId,
      entityType: 'delivery',
      entityId: delivery.id,
      after: { status: result.status },
    });
    return result;
  }
}
