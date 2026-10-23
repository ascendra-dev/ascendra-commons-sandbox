import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../authorization.core';
import { AUTHZ_ACTIONS } from '../authz-api.options';
import type { CreateDelegationBody, DelegationListQuery } from '../dto/authz-api.dto';
import { AuthzObservabilityApiService } from '../observability/authz-observability-api.service';
import { AuthzDelegationApiService } from './authz-delegation-api.service';

/**
 * The delegation ledger and its changes. Static routes (`expiring`, `mine`) are declared before `:id`. Reads are
 * tenant-scoped for anyone but a platform admin. Fails closed without the global `AuthorizationGuard`.
 */
@Controller('authz/delegations')
@UseGuards(AuthorizationEnforcedGuard)
export class AuthzDelegationController {
  constructor(
    @Inject(AuthzDelegationApiService) private readonly service: AuthzDelegationApiService,
    @Inject(AuthzObservabilityApiService) private readonly reads: AuthzObservabilityApiService,
  ) {}

  /** The ledger, newest first — `{ data, meta: { nextCursor } }`. */
  @Get()
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  list(@CurrentActor() actor: Actor, @Query() query: DelegationListQuery) {
    return this.reads.listDelegations(actor, query);
  }

  /** Unrevoked delegations lapsing within `?within=7d` (1–365). */
  @Get('expiring')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  expiring(@CurrentActor() actor: Actor, @Query() query: DelegationListQuery & { within?: string }) {
    return this.reads.listDelegations(actor, query, query.within ?? '7d');
  }

  /** What you lent and what you were lent, in your tenant. */
  @Get('mine')
  @RequiresAction(AUTHZ_ACTIONS.MANAGE_DELEGATIONS)
  mine(@CurrentActor() actor: Actor) {
    return this.service.listMine(actor);
  }

  @Get(':id')
  @RequiresAction(AUTHZ_ACTIONS.VIEW)
  one(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.reads.getDelegation(actor, id);
  }

  /** Lend some of your own actions — tenant-scope ones, to someone else, within the maximum. */
  @Post()
  @RequiresAction(AUTHZ_ACTIONS.MANAGE_DELEGATIONS)
  create(@CurrentActor() actor: Actor, @Body() body: CreateDelegationBody) {
    return this.service.create(actor, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequiresAction(AUTHZ_ACTIONS.MANAGE_DELEGATIONS)
  revoke(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.revoke(actor, id);
  }
}
