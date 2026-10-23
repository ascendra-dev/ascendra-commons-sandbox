import { Inject, Injectable } from '@nestjs/common';
import type { Actor, Authorizer } from '../authorization.core';
import { PermissionResolver } from './resolution/permission-resolver';

/**
 * The database-backed `Authorizer` (Model 2). Resolves `can()` from the actor's
 * assigned roles plus any active delegations — never from `actor.persona`, which
 * is a coarse label the DB model doesn't consult.
 *
 * Stack-agnostic: it depends on `PermissionResolver`, which depends on the
 * `PermissionRepository` port — a Postgres, MySQL, or any other adapter plugs in
 * underneath without this class changing. Was `PostgresPermissionTableAuthorizer`
 * before the family/stack split.
 *
 * Both methods share one load (`effectivePermissions`), one query behind the
 * per-request cache — so a single `can()` is one query, and `allowedActions()`
 * for a `/me` endpoint is also one query rather than one per action.
 */
@Injectable()
export class PermissionTableAuthorizer implements Authorizer {
  // Explicit @Inject — bare type-based injection depends on design:paramtypes
  // metadata that esbuild (vitest, and any consumer building without tsc) does
  // not reliably emit. Same fix as AuthorizationGuard.
  constructor(@Inject(PermissionResolver) private readonly resolver: PermissionResolver) {}

  async can(actor: Actor, action: string): Promise<boolean> {
    const perms = await this.resolver.effectivePermissions(actor);
    return perms.grantsAll || perms.actions.has(action);
  }

  async allowedActions(actor: Actor, candidateActions: string[]): Promise<string[]> {
    const perms = await this.resolver.effectivePermissions(actor);
    return perms.grantsAll ? [...candidateActions] : candidateActions.filter((a) => perms.actions.has(a));
  }
}
