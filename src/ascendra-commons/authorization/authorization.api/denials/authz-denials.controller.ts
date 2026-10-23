import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../authorization.core';
import { AUTHZ_ACTIONS } from '../authz-api.options';
import { AuthzDenialsApiService, type DenialListQuery } from './authz-denials-api.service';

/** Denied requests — who was refused what, in one-minute windows. Tenant-scoped for anyone but a platform admin. */
@Controller('authz/denials')
@UseGuards(AuthorizationEnforcedGuard)
export class AuthzDenialsController {
  constructor(@Inject(AuthzDenialsApiService) private readonly service: AuthzDenialsApiService) {}

  /** `{ data, meta: { nextCursor } }`, newest first — filters actorId, tenantId, action, correlationId, since / until. */
  @Get()
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  list(@CurrentActor() actor: Actor, @Query() query: DenialListQuery) {
    return this.service.list(actor, query);
  }

  /** Totals and the most-denied actions and actors since `?since=` (everything retained when omitted). */
  @Get('summary')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  summary(@CurrentActor() actor: Actor, @Query() query: { tenantId?: string; since?: string }) {
    return this.service.summary(actor, query);
  }
}
