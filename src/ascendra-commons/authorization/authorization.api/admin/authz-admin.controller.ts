import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../authorization.core';
import { AUTHZ_ACTIONS } from '../authz-api.options';
import type { AssignRoleBody, BulkAssignBody, RevokeRoleQuery, SetActionDescriptionBody } from '../dto/authz-api.dto';
import { AuthzAdminApiService } from './authz-admin-api.service';

/**
 * Role assignment and the catalog's descriptions. The rules `@RequiresAction` can't express — tenant and role
 * ceilings, lockout — are `AuthzAdminApiService`'s. Fails closed without the global `AuthorizationGuard`.
 */
@Controller('authz')
@UseGuards(AuthorizationEnforcedGuard)
export class AuthzAdminController {
  constructor(@Inject(AuthzAdminApiService) private readonly service: AuthzAdminApiService) {}

  /** Assign (or renew) a role. 404 unknown role; 403 past a ceiling. */
  @Post('users/:userId/roles')
  @HttpCode(204)
  @RequiresAction(AUTHZ_ACTIONS.ASSIGN_ROLES)
  assign(@CurrentActor() actor: Actor, @Param('userId') userId: string, @Body() body: AssignRoleBody) {
    return this.service.assignRole(actor, userId, body);
  }

  /** Revoke. `?tenantId=` (default your own) or `?global=true`. 404 if not held; 409 if it would lock the tenant out. */
  @Delete('users/:userId/roles/:roleId')
  @HttpCode(204)
  @RequiresAction(AUTHZ_ACTIONS.ASSIGN_ROLES)
  revoke(
    @CurrentActor() actor: Actor,
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @Query() query: RevokeRoleQuery,
  ) {
    return this.service.revokeRole(actor, userId, roleId, query);
  }

  /** One role to many users. */
  @Post('roles/:roleId/holders')
  @RequiresAction(AUTHZ_ACTIONS.ASSIGN_ROLES)
  assignMany(@CurrentActor() actor: Actor, @Param('roleId') roleId: string, @Body() body: BulkAssignBody) {
    return this.service.assignMany(actor, roleId, body);
  }

  /** Every role, and whether you may assign it in `tenantId` (your own by default) — with the reason when not. */
  @Get('roles/assignable')
  @RequiresAction(AUTHZ_ACTIONS.ASSIGN_ROLES)
  assignable(@CurrentActor() actor: Actor, @Query('tenantId') tenantId?: string) {
    return this.service.assignableRoles(actor, tenantId || undefined);
  }

  @Patch('actions/:name')
  @HttpCode(204)
  @RequiresAction(AUTHZ_ACTIONS.MANAGE_CATALOG)
  describeAction(@CurrentActor() actor: Actor, @Param('name') name: string, @Body() body: SetActionDescriptionBody) {
    return this.service.setActionDescription(actor, name, body?.description);
  }
}
