import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { NOTIFICATION_ACTIONS } from '../notification-api.options';
import { NotificationTypesApiService } from './notification-types-api.service';

/**
 * The notification types — what the app declares in `NotificationModule.forRoot({ types })`, joined with the routes,
 * templates and gaps that serve each. Gated on `notification.view`, scoped like the config reads. Requires
 * `AuthorizationGuard` wired globally as `APP_GUARD` — and fails closed without it (`AuthorizationEnforcedGuard`).
 */
@Controller('notifications/types')
@UseGuards(AuthorizationEnforcedGuard)
export class NotificationTypesController {
  constructor(@Inject(NotificationTypesApiService) private readonly service: NotificationTypesApiService) {}

  @Get()
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  list(@CurrentActor() actor: Actor) {
    return this.service.list(actor);
  }

  @Get(':name')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  detail(@CurrentActor() actor: Actor, @Param('name') name: string) {
    return this.service.detail(actor, name);
  }
}
