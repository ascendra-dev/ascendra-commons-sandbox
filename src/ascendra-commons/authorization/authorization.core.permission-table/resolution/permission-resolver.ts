import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../authorization.core';
import { memoizePermissionLookup } from '../cache/permission-cache';
import type { PermissionRepository } from '../ports/permission-repository.port';
import type { ResolvedPermissions } from '../types/resolved-permissions';
import { PERMISSION_REPOSITORY } from '../tokens';

function cacheKey(prefix: string, actor: Actor): string {
  return `${prefix}:${actor.id}:${actor.tenantId ?? ''}`;
}

/**
 * The stack-agnostic resolution algorithm: turn a `PermissionRepository`'s raw
 * reads into an actor's effective permission set, behind the per-request cache.
 * Shared by `PermissionTableAuthorizer` (for `can()` / `allowedActions()`) and
 * `DelegationService` (for its grant-time "does the granter hold this from their
 * roles" check). Was `PermissionLoader` before the family/stack split.
 */
@Injectable()
export class PermissionResolver {
  constructor(@Inject(PERMISSION_REPOSITORY) private readonly repo: PermissionRepository) {}

  /** Actions granted by the actor's assigned roles (in this tenant, or globally). Excludes delegations. */
  rolePermissions(actor: Actor): Promise<ResolvedPermissions> {
    return memoizePermissionLookup(cacheKey('role', actor), async () => {
      const set = await this.repo.loadRolePermissions(actor.id, actor.tenantId);
      return { grantsAll: set.grantsAll, actions: new Set(set.actions) };
    });
  }

  /** Actions delegated to the actor that are still active (not revoked, not expired). */
  delegatedActions(actor: Actor): Promise<ReadonlySet<string>> {
    return memoizePermissionLookup(cacheKey('deleg', actor), async () => {
      if (actor.tenantId === null) return new Set<string>(); // delegation is always within a tenant
      return new Set(await this.repo.loadActiveDelegatedActions(actor.id, actor.tenantId));
    });
  }

  /** Roles ∪ active delegations — what `can()` / `allowedActions()` answer against. */
  async effectivePermissions(actor: Actor): Promise<ResolvedPermissions> {
    const [roles, delegated] = await Promise.all([this.rolePermissions(actor), this.delegatedActions(actor)]);
    if (roles.grantsAll) return roles;
    return { grantsAll: false, actions: new Set([...roles.actions, ...delegated]) };
  }
}
