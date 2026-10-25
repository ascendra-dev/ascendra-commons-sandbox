import { Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, NoActionRequired, type Actor } from '../../../authorization/authorization.core';
import { cursorList, flagParam, positiveIntParam } from '../shared/params';
import { NotificationInboxApiService } from './notification-inbox-api.service';

/**
 * A signed-in user's in-app inbox — `@NoActionRequired`: everyone reads their own, and only that. Requires
 * `AuthorizationGuard` wired globally as `APP_GUARD` — and fails closed without it (`AuthorizationEnforcedGuard`).
 * Static routes are declared before `:id`.
 */
@Controller('notifications/inbox')
@UseGuards(AuthorizationEnforcedGuard)
export class NotificationInboxController {
  constructor(@Inject(NotificationInboxApiService) private readonly service: NotificationInboxApiService) {}

  /** Newest first; `?unread=true` for unread only. */
  @Get()
  @NoActionRequired()
  async list(
    @CurrentActor() actor: Actor,
    @Query('unread') unread?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const page = await this.service.list(actor, {
      unreadOnly: unread === undefined || unread === '' ? undefined : flagParam('unread', unread),
      limit: positiveIntParam('limit', limit),
      cursor,
    });
    return cursorList(page.items, page.nextCursor);
  }

  /** The badge. */
  @Get('unread-count')
  @NoActionRequired()
  unreadCount(@CurrentActor() actor: Actor) {
    return this.service.unreadCount(actor);
  }

  @Post('read-all')
  @NoActionRequired()
  markAllRead(@CurrentActor() actor: Actor) {
    return this.service.markAllRead(actor);
  }

  @Post(':id/read')
  @HttpCode(204)
  @NoActionRequired()
  markRead(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.markRead(actor, id);
  }
}
