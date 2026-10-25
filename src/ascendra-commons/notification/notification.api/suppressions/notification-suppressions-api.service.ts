import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import {
  InvalidDeliveryCursorError,
  NOTIFICATION_CONFIG_ADMIN_PORT,
  type NotificationConfigAdminPort,
  type SuppressionPage,
} from '../../notification.core.database';
import { NOTIFICATION_API_OPTIONS, NOTIFICATION_AUDIT_EMITTER } from '../tokens';
import type { NotificationApiOptions } from '../notification-api.options';
import type { NotificationAuditEmitter } from '../notification-audit.port';

/**
 * The suppression list — recipients a channel stopped sending to after a hard bounce or a complaint. A tenant admin
 * sees and clears their own tenant's entries; a platform admin every one (tenantless ones too). Removing one is
 * audited: the recipient is sent to again.
 */
@Injectable()
export class NotificationSuppressionsApiService {
  constructor(
    @Inject(NOTIFICATION_CONFIG_ADMIN_PORT) private readonly port: NotificationConfigAdminPort,
    @Inject(NOTIFICATION_API_OPTIONS) private readonly options: NotificationApiOptions,
    @Inject(NOTIFICATION_AUDIT_EMITTER) private readonly audit: NotificationAuditEmitter,
  ) {}

  async list(actor: Actor, query: { limit?: number; cursor?: string }): Promise<SuppressionPage> {
    const scope = (await this.options.isPlatformAdmin(actor)) ? undefined : { tenantId: actor.tenantId ?? '' };
    try {
      return await this.port.listSuppressions({ limit: query.limit, cursor: query.cursor || undefined }, scope);
    } catch (err) {
      if (err instanceof InvalidDeliveryCursorError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const entry = await this.port.getSuppression(id);
    // Another tenant's entry is the same 404 as a missing one.
    if (!entry || (!(await this.options.isPlatformAdmin(actor)) && entry.tenantId !== actor.tenantId)) {
      throw new NotFoundException('no such suppression');
    }
    await this.port.deleteSuppression(id);
    await this.audit.record({
      action: 'notification.suppression_removed',
      actorId: actor.id,
      tenantId: entry.tenantId,
      entityType: 'suppression',
      entityId: `${entry.channel}:${entry.recipientKey}`,
      before: entry,
    });
  }
}
