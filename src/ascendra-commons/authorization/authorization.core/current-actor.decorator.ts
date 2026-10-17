import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Actor } from './actor.type';

/**
 * Reads `request.actor` — populated by the consuming project's authentication
 * guard, exactly as `AuthorizationGuard` expects it. Throws
 * `UnauthorizedException` if absent (a route was reached without authentication
 * — a wiring mistake). Used by `.api` packages (`authorization.api`,
 * `notification.api`) that need the actor for actor-scoped rules.
 */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const request = ctx.switchToHttp().getRequest<{ actor?: Actor }>();
  if (!request.actor) throw new UnauthorizedException();
  return request.actor;
});
