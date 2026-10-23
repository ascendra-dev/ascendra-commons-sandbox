import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import type { Actor, Authorizer } from '../../authorization.core';
import { PERMISSION_TABLE_AUTHORIZER } from '../../authorization.core.permission-table';
import { AUTHZ_ACTIONS, type AuthzApiOptions } from '../authz-api.options';
import { AUTHZ_API_OPTIONS } from '../tokens';

/**
 * Whose access an actor may read or change. A platform admin (holds `authz.platform`, or `isPlatformAdmin`) works
 * across tenants; anyone else works in their own tenant only — forced here, never trusted from the request.
 */
@Injectable()
export class AuthzAccessScope {
  constructor(
    @Inject(AUTHZ_API_OPTIONS) private readonly options: AuthzApiOptions,
    @Optional() @Inject(PERMISSION_TABLE_AUTHORIZER) private readonly authorizer?: Authorizer,
  ) {}

  /** Fails closed: with no override and no permission-table authorizer, nobody is a platform admin. */
  async isPlatform(actor: Actor): Promise<boolean> {
    if (this.options.isPlatformAdmin) return this.options.isPlatformAdmin(actor);
    return (await this.authorizer?.can(actor, AUTHZ_ACTIONS.PLATFORM)) ?? false;
  }

  /** The actions `actor` holds in its own tenant, among `actions` — what it may hand on. */
  async heldActions(actor: Actor, actions: readonly string[]): Promise<Set<string>> {
    if (!this.authorizer || actions.length === 0) return new Set();
    if (this.authorizer.allowedActions) return new Set(await this.authorizer.allowedActions(actor, [...actions]));
    const checks = await Promise.all(actions.map((a) => this.authorizer!.can(actor, a)));
    return new Set(actions.filter((_, i) => checks[i]));
  }

  /**
   * The tenant a read covers. A platform admin gets what it asked for (`undefined` = every tenant). Anyone else gets
   * their own tenant; asking for another is a 403.
   */
  async readTenant(actor: Actor, requested: string | undefined): Promise<string | undefined> {
    if (await this.isPlatform(actor)) return requested;
    return this.ownTenant(actor, requested);
  }

  /**
   * The tenant a change lands in. A platform admin: what it asked for — `null` a global (all-tenant) assignment,
   * omitted its own tenant. Anyone else: their own tenant only.
   */
  async writeTenant(actor: Actor, requested: string | null | undefined): Promise<string | null> {
    if (await this.isPlatform(actor)) return requested === undefined ? actor.tenantId : requested;
    if (requested === null) throw new ForbiddenException('Only a platform admin can make an all-tenant assignment.');
    return this.ownTenant(actor, requested);
  }

  private ownTenant(actor: Actor, requested: string | undefined): string {
    if (actor.tenantId === null) throw new ForbiddenException('You need a tenant to manage access — or authz.platform.');
    if (requested !== undefined && requested !== actor.tenantId) {
      throw new ForbiddenException("You can only see and change access in your own tenant.");
    }
    return actor.tenantId;
  }
}
