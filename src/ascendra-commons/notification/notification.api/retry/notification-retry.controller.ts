import { Controller, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { NOTIFICATION_ACTIONS } from '../notification-api.options';
import { NotificationRetryApiService } from './notification-retry-api.service';

/**
 * Resend a failed delivery — `notification.retry`: it reaches a real customer. Requires `AuthorizationGuard` wired
 * globally as `APP_GUARD` — and fails closed without it (`AuthorizationEnforcedGuard`).
 */
@Controller('notifications/deliveries')
@UseGuards(AuthorizationEnforcedGuard)
export class NotificationRetryController {
  constructor(@Inject(NotificationRetryApiService) private readonly service: NotificationRetryApiService) {}

  @Post(':id/retry')
  @RequiresAction(NOTIFICATION_ACTIONS.RETRY)
  retry(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.retry(actor, id);
  }
}
