import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Actor } from '../ascendra-commons/authorization/authorization.core';
import { DevTokenService } from './dev-token.service';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Authentication — "who is this": reads `Authorization: Bearer <dev token>` and sets `request.actor`, which the
 * vendored AuthorizationGuard (registered after this one) and `@CurrentActor()` read. Every route needs a token
 * unless it's `@Public()`.
 */
@Injectable()
export class DevAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DevTokenService) private readonly tokens: DevTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; actor?: Actor }>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Sign in first — send Authorization: Bearer <token> (POST /dev/token).');

    const actor = await this.tokens.verify(token);
    if (!actor) throw new UnauthorizedException('The token is invalid or expired — get a new one from POST /dev/token.');
    request.actor = actor;
    return true;
  }
}
