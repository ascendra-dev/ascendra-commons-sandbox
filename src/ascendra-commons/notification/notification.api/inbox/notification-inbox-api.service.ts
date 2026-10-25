import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import {
  InvalidDeliveryCursorError,
  NOTIFICATION_INBOX_STORE,
  type InboxPage,
  type NotificationInboxStore,
} from '../../notification.core.database';

/**
 * A signed-in user's own in-app inbox — always the actor's items in the actor's tenant; there is no parameter naming
 * whose. Another user's item is the same 404 as a missing one.
 */
@Injectable()
export class NotificationInboxApiService {
  constructor(@Optional() @Inject(NOTIFICATION_INBOX_STORE) private readonly store?: NotificationInboxStore) {}

  async list(actor: Actor, query: { unreadOnly?: boolean; limit?: number; cursor?: string }): Promise<InboxPage> {
    try {
      return await this.inbox().list(actor.id, actor.tenantId, { ...query, cursor: query.cursor || undefined });
    } catch (err) {
      if (err instanceof InvalidDeliveryCursorError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  async unreadCount(actor: Actor): Promise<{ unread: number }> {
    return { unread: await this.inbox().unreadCount(actor.id, actor.tenantId) };
  }

  async markRead(actor: Actor, id: string): Promise<void> {
    if (!(await this.inbox().markRead(actor.id, actor.tenantId, id))) throw new NotFoundException('no such inbox item');
  }

  async markAllRead(actor: Actor): Promise<{ marked: number }> {
    return { marked: await this.inbox().markAllRead(actor.id, actor.tenantId) };
  }

  private inbox(): NotificationInboxStore {
    if (!this.store) throw new NotFoundException('the in-app inbox is not enabled in this app');
    return this.store;
  }
}
