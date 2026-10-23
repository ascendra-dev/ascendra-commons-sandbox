import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, NoActionRequired, RequiresAction, type Actor } from '../../authorization.core';
import { AUTHZ_ACTIONS } from '../authz-api.options';
import type { AssignmentListQuery, ExplainAccessQuery, WhoCanQuery } from '../dto/authz-api.dto';
import { AuthzObservabilityApiService } from './authz-observability-api.service';

/**
 * The console's reads — roles, the action catalog, assignments, explain, who-can, catalog health — and every signed-in
 * user's own access. Tenant-scoped for anyone but a platform admin. Fails closed without the global
 * `AuthorizationGuard`. (`roles/assignable` lives on the admin controller, gated on `authz.assign_roles`, and is
 * registered first — before `roles/:id`.)
 */
@Controller('authz')
@UseGuards(AuthorizationEnforcedGuard)
export class AuthzObservabilityController {
  constructor(@Inject(AuthzObservabilityApiService) private readonly service: AuthzObservabilityApiService) {}

  /** Your roles, delegations and effective actions in your tenant — no action needed beyond being signed in. */
  @Get('me/access')
  @NoActionRequired()
  me(@CurrentActor() actor: Actor) {
    return this.service.myAccess(actor);
  }

  @Get('roles')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  roles() {
    return this.service.listRoles();
  }

  @Get('roles/:id')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  role(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.getRole(actor, id);
  }

  @Get('actions')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  actions() {
    return this.service.listActions();
  }

  /** `{ data, meta: { nextCursor } }`; filters userId, roleId, tenantId (or `global=true`), status, `expiring=7d`. */
  @Get('assignments')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  assignments(@CurrentActor() actor: Actor, @Query() query: AssignmentListQuery) {
    return this.service.listAssignments(actor, query);
  }

  @Get('explain')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  explain(@CurrentActor() actor: Actor, @Query() query: ExplainAccessQuery) {
    return this.service.explainAccess(actor, query);
  }

  @Get('who-can')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  whoCan(@CurrentActor() actor: Actor, @Query() query: WhoCanQuery) {
    return this.service.whoCan(actor, query);
  }

  @Get('action-catalog/health')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  catalogHealth() {
    return this.service.actionCatalogHealth();
  }
}
