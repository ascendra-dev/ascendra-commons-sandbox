import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../authorization.core';
import { AUTHZ_ACTIONS } from '../authz-api.options';
import { AuthzPeopleApiService } from './authz-people-api.service';

/**
 * People and posture: the app's users joined to their access (needs an `AuthzUserDirectory` — else 501), and the
 * Overview's numbers. Tenant-scoped for anyone but a platform admin. `users/lookup` is declared before `users/:id`.
 */
@Controller('authz')
@UseGuards(AuthorizationEnforcedGuard)
export class AuthzPeopleController {
  constructor(@Inject(AuthzPeopleApiService) private readonly service: AuthzPeopleApiService) {}

  /**
   * `{ data, meta: { nextCursor } }` — users by name, each with their active roles. `?tenantId`, `?search`,
   * `?roleId` (that role's holders) or `?roleless=true` (people holding none).
   */
  @Get('users')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  users(
    @CurrentActor() actor: Actor,
    @Query() query: { tenantId?: string; search?: string; limit?: string; cursor?: string; roleId?: string; roleless?: string },
  ) {
    return this.service.listUsers(actor, query);
  }

  /** `?ids=a,b,c` (≤ 200) → those users' names — what an assignment or delegation list shows. */
  @Get('users/lookup')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  lookup(@CurrentActor() actor: Actor, @Query('ids') ids?: string) {
    return this.service.lookup(actor, ids);
  }

  @Get('users/:id')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  profile(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.profile(actor, id);
  }

  @Get('stats')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  stats(@CurrentActor() actor: Actor, @Query('tenantId') tenantId?: string) {
    return this.service.stats(actor, tenantId);
  }
}
