import { Actor } from './actor.type';
import { Authorizer } from './authorizer.port';

export interface SessionSnapshot {
  actor: Actor;
  allowedActions: string[];
}

/**
 * The computation behind a project's own `GET /me` endpoint — not a shipped
 * controller, since the route, DTO shape, and the full list of actions that
 * exist are all project-specific. A consuming project writes a thin
 * controller calling this:
 *
 *   @Get('me')
 *   async me(@CurrentUser() actor: Actor) {
 *     return computeSessionSnapshot(actor, Object.values(Actions), this.authorizer);
 *   }
 *
 * Fetched once at session bootstrap by the frontend. Menus/routes are hidden
 * based on membership in allowedActions — never disabled, since a persona
 * that can never do something should not see it at all (see this module's
 * README, "Hide vs. disable").
 *
 * If the authorizer implements `allowedActions` (the database-backed adapter
 * does), this resolves in one call — one query, not one per action. Otherwise
 * it falls back to calling `can()` per action; fine for an in-memory
 * authorizer, a needless N+1 against a database one.
 */
export async function computeSessionSnapshot(
  actor: Actor,
  allActions: string[],
  authorizer: Authorizer,
): Promise<SessionSnapshot> {
  if (authorizer.allowedActions) {
    return { actor, allowedActions: await authorizer.allowedActions(actor, allActions) };
  }
  const checks = await Promise.all(allActions.map((action) => authorizer.can(actor, action)));
  const allowedActions = allActions.filter((_, index) => checks[index]);
  return { actor, allowedActions };
}
