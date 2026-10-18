import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Actor } from './actor.type';
import { Authorizer } from './authorizer.port';
import { ACTION_METADATA_KEY, NO_ACTION_REQUIRED_KEY } from './requires-action.decorator';
import { AUTHORIZER } from './tokens';

/**
 * Thrown when an endpoint under AuthorizationGuard declares neither
 * `@RequiresAction()` nor `@NoActionRequired()`. A developer mistake, not a
 * client error — it surfaces as a 500 and fails closed (the request never
 * reaches the handler), so a state-changing endpoint that forgot its
 * `@RequiresAction()` cannot ship silently open.
 */
export class AuthorizationNotDeclaredError extends Error {
  constructor(target: string) {
    super(
      `${target} is behind AuthorizationGuard but declares neither @RequiresAction() nor ` +
        '@NoActionRequired(). Add @RequiresAction(\'<resource>.<verb>\') to gate it, or ' +
        '@NoActionRequired() if it is intentionally open (health check, login, public view, webhook).',
    );
    this.name = 'AuthorizationNotDeclaredError';
  }
}

/**
 * Expects `request.actor: Actor` to already be populated by the time this
 * guard runs — by the consuming project's own authentication guard/middleware,
 * ordered before this one. This guard only answers "can this actor do this
 * action," never "who is this actor" — that's authentication, deliberately a
 * separate concern (see this module's README).
 *
 * **Deny-by-default.** Every endpoint this guard covers must declare its
 * authorization intent — `@RequiresAction('resource.verb')` to gate it, or
 * `@NoActionRequired()` to opt out explicitly. An endpoint with neither throws
 * `AuthorizationNotDeclaredError` (500, fails closed) rather than being let
 * through — so forgetting `@RequiresAction()` on a new state-changing endpoint
 * is a loud error, not a silently-open route. Both decorators work on a method
 * or a whole controller class; a method-level declaration wins over a
 * class-level one.
 *
 * HTTP only — it reads the actor off the HTTP request (`switchToHttp()`). A
 * consumer adding a GraphQL or microservice transport needs a context-aware
 * variant that resolves the actor for that transport; the `Authorizer` /
 * `can()` layer underneath is transport-agnostic and reusable as-is.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  // Explicit @Inject(Reflector), not bare type-based constructor injection —
  // the same fix already applied to InProcessDomainEventEmitter in domain-events, for
  // the identical reason: bare type-based injection depends on
  // design:paramtypes reflection metadata that esbuild-based transpilation
  // (vitest, and any consumer building without tsc) does not reliably emit.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AUTHORIZER) private readonly authorizer: Authorizer,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();

    // Method-level declaration wins over class-level, whichever kind it is:
    // resolve the handler fully first, only fall to the controller if the
    // handler declared nothing at all.
    const decision = this.declarationFor(handler) ?? this.declarationFor(controller);
    if (!decision) {
      throw new AuthorizationNotDeclaredError(`${controller.name}.${handler.name}()`);
    }
    if (decision.kind === 'no-action-required') return true;

    const request = context.switchToHttp().getRequest<{ actor?: Actor }>();
    const actor = request.actor;
    if (!actor) {
      // Defensive: this guard assumes an upstream authentication step already
      // populated request.actor. If it didn't (misconfigured guard order, a
      // route that skipped auth by mistake), fail as "not authenticated"
      // rather than crashing on a read of an undefined actor's persona.
      throw new UnauthorizedException('Sign in to continue.');
    }

    if (!(await this.authorizer.can(actor, decision.action))) {
      // Names the missing action: the caller can see what they lack (the frontend already knows every action name
      // from GET /me), instead of a bare "Forbidden resource".
      throw new ForbiddenException(`You don't have permission for this — it needs "${decision.action}".`);
    }
    return true;
  }

  private declarationFor(
    target: Parameters<Reflector['get']>[1],
  ): { kind: 'requires-action'; action: string } | { kind: 'no-action-required' } | undefined {
    const action = this.reflector.get<string | undefined>(ACTION_METADATA_KEY, target);
    if (action) return { kind: 'requires-action', action };
    if (this.reflector.get<boolean>(NO_ACTION_REQUIRED_KEY, target)) return { kind: 'no-action-required' };
    return undefined;
  }
}
