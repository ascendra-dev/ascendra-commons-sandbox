import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/** Set on the request by `AuthorizationGuard` once it has let the request through. */
export const AUTHORIZATION_CHECKED = Symbol('AUTHORIZATION_CHECKED');

export class AuthorizationNotEnforcedError extends Error {
  constructor(target: string) {
    super(
      `${target} requires AuthorizationGuard, but it didn't run — register it as a global guard ` +
        "(`{ provide: APP_GUARD, useExisting: AuthorizationGuard }`, after the guard that sets request.actor).",
    );
    this.name = 'AuthorizationNotEnforcedError';
  }
}

/**
 * Makes a controller fail closed when `AuthorizationGuard` isn't running. `@RequiresAction()` is only metadata: if a
 * consuming app doesn't register `AuthorizationGuard` as a global `APP_GUARD`, nothing reads it, and every route behind
 * it is open to anyone the app's authentication lets in. A controller that ships in a library adds this one —
 * `@UseGuards(AuthorizationEnforcedGuard)`. Global guards run before controller guards, so by now `AuthorizationGuard`
 * has marked the request; if it hasn't, it was never registered, and the request ends with a 500 that names the fix.
 *
 * No dependencies — it checks the mark, so a request is still authorized exactly once.
 */
@Injectable()
export class AuthorizationEnforcedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Record<symbol, unknown>>();
    if (request[AUTHORIZATION_CHECKED] === true) return true;
    throw new AuthorizationNotEnforcedError(`${context.getClass().name}.${context.getHandler().name}()`);
  }
}
