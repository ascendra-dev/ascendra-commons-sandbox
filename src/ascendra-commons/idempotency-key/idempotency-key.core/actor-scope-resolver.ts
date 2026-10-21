import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { IdempotencyScopeResolver } from './idempotency-scope-resolver.port';

/**
 * Only the two fields actually needed — not authorization's own Actor type,
 * so this pattern stays independently copyable without also vendoring
 * authorization just for a type shape.
 */
interface RequestWithActor {
  actor?: { id: string; tenantId: string | null };
}

/**
 * The default for an authenticated endpoint — not sufficient on its own for
 * one reachable anonymously (see this pattern's README). Throws rather than
 * silently deriving a bogus scope from a missing actor.
 */
@Injectable()
export class ActorScopeResolver implements IdempotencyScopeResolver {
  async resolveScope(request: RequestWithActor): Promise<string> {
    if (!request.actor) throw new UnauthorizedException();
    return request.actor.tenantId ?? request.actor.id;
  }
}
