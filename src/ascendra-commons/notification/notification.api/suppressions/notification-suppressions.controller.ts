import { Controller, Delete, Get, HttpCode, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { NOTIFICATION_ACTIONS } from '../notification-api.options';
import { cursorList, positiveIntParam } from '../shared/params';
import { NotificationSuppressionsApiService } from './notification-suppressions-api.service';

/**
 * The suppression list — read on `notification.view`, cleared on `notification.manage_config`, tenant-scoped.
 * Requires `AuthorizationGuard` wired globally as `APP_GUARD` — and fails closed without it (`AuthorizationEnforcedGuard`).
 */
@Controller('notifications/suppressions')
@UseGuards(AuthorizationEnforcedGuard)
export class NotificationSuppressionsController {
  constructor(@Inject(NotificationSuppressionsApiService) private readonly service: NotificationSuppressionsApiService) {}

  @Get()
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  async list(
    @CurrentActor() actor: Actor,
    @Query('recipientKey') recipientKey?: string,
    @Query('channel') channel?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const page = await this.service.list(actor, { recipientKey, channel, limit: positiveIntParam('limit', limit), cursor });
    return cursorList(page.suppressions, page.nextCursor);
  }

  /** The recipient is sent to again on that channel. */
  @Delete(':id')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.remove(actor, id);
  }
}
