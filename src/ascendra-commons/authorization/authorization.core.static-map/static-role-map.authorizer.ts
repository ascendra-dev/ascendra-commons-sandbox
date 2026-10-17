import { Inject, Injectable } from '@nestjs/common';
import type { Actor, Authorizer } from '../authorization.core';
import { PERSONA_ACTIONS_DATA } from './tokens';

/**
 * Model 1 — data, not code. Feature code calls `authorizer.can(actor, 'invoice.create')`;
 * it never inspects `actor.persona` directly, and never hardcodes a permission
 * list inline. No admin UI to manage roles, no database table for permissions —
 * the entire model is a constant object and a lookup function. This is
 * intentional: building and testing the *administration* of a permission system
 * nobody yet needs is the cost this pattern exists to avoid, not the concept of
 * roles itself.
 *
 * `'*'` for a persona means unrestricted access by definition (a platform-admin
 * persona, say) — not a maintained list every new action must be added to. A
 * persona with **no entry at all** in the map is denied, not treated as
 * unrestricted — fails closed.
 *
 * `can()` is async only to match the `Authorizer` contract; the lookup itself
 * is synchronous and wrapping it in a resolved promise costs nothing real.
 */
@Injectable()
export class StaticRoleMapAuthorizer implements Authorizer {
  constructor(@Inject(PERSONA_ACTIONS_DATA) private readonly personaActions: Record<string, string[] | '*'>) {}

  async can(actor: Actor, action: string): Promise<boolean> {
    const allowed = this.personaActions[actor.persona];
    if (allowed === undefined) return false; // an unconfigured persona is denied, not treated as unrestricted
    return allowed === '*' ? true : allowed.includes(action);
  }

  async allowedActions(actor: Actor, candidateActions: string[]): Promise<string[]> {
    const allowed = this.personaActions[actor.persona];
    if (allowed === undefined) return [];
    if (allowed === '*') return [...candidateActions];
    const set = new Set(allowed);
    return candidateActions.filter((action) => set.has(action));
  }
}
