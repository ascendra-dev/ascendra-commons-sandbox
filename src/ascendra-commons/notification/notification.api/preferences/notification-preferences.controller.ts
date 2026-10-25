import { Body, Controller, Get, HttpCode, Inject, Put, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, NoActionRequired, type Actor } from '../../../authorization/authorization.core';
import { NotificationPreferencesApiService } from './notification-preferences-api.service';

/**
 * A signed-in user's own notification preferences — `@NoActionRequired`: everyone may manage what reaches them, and
 * only that (the user is the actor). Requires `AuthorizationGuard` wired globally as `APP_GUARD` — and fails closed
 * without it (`AuthorizationEnforcedGuard`).
 */
@Controller('notifications/preferences')
@UseGuards(AuthorizationEnforcedGuard)
export class NotificationPreferencesController {
  constructor(@Inject(NotificationPreferencesApiService) private readonly service: NotificationPreferencesApiService) {}

  @Get('me')
  @NoActionRequired()
  mine(@CurrentActor() actor: Actor) {
    return this.service.mine(actor);
  }

  /** `{ notificationType, channel, enabled }` — either may be `*`. */
  @Put('me')
  @HttpCode(204)
  @NoActionRequired()
  set(@CurrentActor() actor: Actor, @Body() body: { notificationType?: unknown; channel?: unknown; enabled?: unknown }) {
    return this.service.set(actor, body);
  }
}
