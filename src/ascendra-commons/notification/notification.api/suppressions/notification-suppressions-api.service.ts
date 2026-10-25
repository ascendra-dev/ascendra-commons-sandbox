import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { USER_CONTACT_RESOLVER, type UserContactResolver } from '../../notification.core';
import { recipientNames } from '../shared/recipient-names';
import type { Actor } from '../../../authorization/authorization.core';
import {
  InvalidDeliveryCursorError,
  NOTIFICATION_CONFIG_ADMIN_PORT,
  type NotificationConfigAdminPort,
  type SuppressionView,
} from '../../notification.core.database';
import { NOTIFICATION_API_OPTIONS, NOTIFICATION_AUDIT_EMITTER } from '../tokens';
import type { NotificationApiOptions } from '../notification-api.options';
import type { NotificationAuditEmitter } from '../notification-audit.port';

/** An entry, and whether this actor may remove it. */
export type SuppressionEntry = SuppressionView & { removable: boolean; recipientName: string | null };

/**
 * The suppression list — recipients a channel stopped sending to after a hard bounce or a complaint. An entry applies
 * to the whole app; a tenant admin sees every one its sends are affected by (filed under it, or for a recipient it has
 * sent to) and removes those filed under it — one another tenant's bounce filed is the platform admin's to remove. A
 * platform admin sees and removes every one. Removing is audited: the recipient is sent to again.
 */
@Injectable()
export class NotificationSuppressionsApiService {
  constructor(
    @Inject(NOTIFICATION_CONFIG_ADMIN_PORT) private readonly port: NotificationConfigAdminPort,
    @Inject(NOTIFICATION_API_OPTIONS) private readonly options: NotificationApiOptions,
    @Inject(NOTIFICATION_AUDIT_EMITTER) private readonly audit: NotificationAuditEmitter,
    @Optional() @Inject(USER_CONTACT_RESOLVER) private readonly users: UserContactResolver | null = null,
  ) {}

  async list(actor: Actor, query: { limit?: number; cursor?: string }): Promise<{ suppressions: SuppressionEntry[]; nextCursor?: string }> {
    const platform = await this.options.isPlatformAdmin(actor);
    const scope = platform ? undefined : { tenantId: actor.tenantId ?? '' };
    try {
      const page = await this.port.listSuppressions({ limit: query.limit, cursor: query.cursor || undefined }, scope);
      const names = await recipientNames(this.users, page.suppressions.map((s) => s.recipientKey));
      return {
        suppressions: page.suppressions.map((s) => ({
          ...s,
          removable: platform || s.tenantId === actor.tenantId,
          recipientName: names.get(s.recipientKey) ?? null,
        })),
        nextCursor: page.nextCursor,
      };
    } catch (err) {
      if (err instanceof InvalidDeliveryCursorError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const platform = await this.options.isPlatformAdmin(actor);
    // One the actor's tenant isn't affected by is the same 404 as a missing one.
    const entry = await this.port.getSuppression(id, platform ? undefined : { tenantId: actor.tenantId ?? '' });
    if (!entry) throw new NotFoundException('no such suppression');
    if (!platform && entry.tenantId !== actor.tenantId) {
      throw new ForbiddenException("another tenant's bounce filed this entry, and it stops their sends too — a platform admin can remove it");
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
