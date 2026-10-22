import { BadRequestException, CallHandler, ConflictException, ExecutionContext, HttpException, Inject, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, from, map, of, switchMap, throwError } from 'rxjs';
import type { IdempotencyStore } from './idempotency-store.port';
import type { IdempotencyScopeResolver } from './idempotency-scope-resolver.port';
import { IDEMPOTENCY_SCOPE_RESOLVER, IDEMPOTENCY_STORE } from './tokens';

interface MinimalRequest {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  /** Express: the matched route. */
  route?: { path?: string };
  /** Fastify ≥ 4: the matched route's options. */
  routeOptions?: { url?: string };
  /** Fastify < 4. */
  routerPath?: string;
}

/**
 * An `Idempotency-Key` it will claim: 1–255 printable ASCII characters (a UUID is the usual choice; 255 is Stripe's
 * limit). The key is half the primary key, so an unbounded one is a stored, indexed, caller-controlled string — and
 * past ~2.7 KB of incompressible text Postgres can't index the row at all, a 500 on the request it was protecting.
 */
const IDEMPOTENCY_KEY = /^[\x20-\x7E]{1,255}$/;

/** A correlation id worth storing — the header is caller-controlled, so anything else is dropped rather than recorded. */
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * The route *pattern* (`/payments/:id`), never the resolved URL — so claims group by endpoint, and no id or token in
 * the path is stored. Falls back to `Controller.handler` when the platform exposes neither.
 */
function routePattern(request: MinimalRequest, context: ExecutionContext): string {
  return (
    request.route?.path ??
    request.routeOptions?.url ??
    request.routerPath ??
    `${context.getClass().name}.${context.getHandler().name}`
  );
}

/**
 * A 409 on 'in_progress' is deliberate: this interceptor never blocks a
 * request waiting for another one to finish (that ties up a request thread
 * for an unbounded time) — it fails fast. The frontend is expected to have
 * the submit control disabled while the first attempt is in flight anyway;
 * this is a safety net for the case that discipline doesn't catch, not the
 * primary defense.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore,
    @Inject(IDEMPOTENCY_SCOPE_RESOLVER) private readonly scopeResolver: IdempotencyScopeResolver,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<MinimalRequest>();
    const key = request.headers['idempotency-key'];
    if (!key || typeof key !== 'string') return next.handle(); // endpoint doesn't require it, or client omitted it
    if (!IDEMPOTENCY_KEY.test(key)) {
      throw new BadRequestException('"Idempotency-Key" must be 1–255 printable ASCII characters — a UUID is the usual choice');
    }

    // Same header (`x-correlation-id`) audit-logging's own CorrelationIdMiddleware reads —
    // reused by convention, not by dependency: this module stays self-contained (no import
    // from audit-logging), but the two naturally agree when both are wired in the same app.
    const correlationHeader = request.headers['x-correlation-id'];
    const correlationId =
      typeof correlationHeader === 'string' && CORRELATION_ID.test(correlationHeader) ? correlationHeader : undefined;

    const scope = await this.scopeResolver.resolveScope(request);
    const claim = await this.store.claim(key, scope, { correlationId, route: routePattern(request, context) });

    if (claim.status === 'completed') {
      // Replay verbatim, including the original status — a cached error must come back as
      // that same error, not silently reported as a success with the error's body.
      const { statusCode, body } = claim.response;
      return statusCode >= 400
        ? throwError(() => new HttpException(body as string | Record<string, unknown>, statusCode))
        : of(body);
    }
    if (claim.status === 'in_progress') throw new ConflictException();

    if (claim.reclaimedStale) {
      // Not thrown, not blocked — the request proceeds exactly as a fresh claim would.
      // Logged because a reclaim is the scenario staleAfterSeconds's doc comment warns
      // about: if the original owner was in fact still running, this is now a genuine
      // duplicate execution. See idempotency-key.core.postgres-drizzle's observability
      // service for the counted, queryable version of this same signal.
      this.logger.warn(
        `Idempotency-Key "${key}" (scope "${scope}") was reclaimed as stale — a previous ` +
          `claim on this key was presumed abandoned. If that claim was still genuinely in ` +
          `flight, this is a duplicate execution; consider whether staleAfterSeconds is set ` +
          `too low for this endpoint.`,
      );
    }

    const { claimId } = claim;

    // The real status this handler will return — @HttpCode() if set, otherwise NestJS's own
    // default (201 for POST, 200 otherwise). Never hardcoded: every endpoint this pattern is
    // meant for is a POST that plausibly returns 201, and a cached response claiming 200 would
    // simply be wrong.
    const explicitCode = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler());
    const statusCode = explicitCode ?? (request.method === 'POST' ? 201 : 200);

    return next.handle().pipe(
      // switchMap, not tap — tap's callback isn't awaited, which would let the client receive
      // a response before this write actually lands. A retry arriving in that window would
      // still see the row as 'pending' and get a wrong 409 instead of the correct cached
      // response. Awaiting here, before the response is emitted, closes that race.
      switchMap((body) => from(this.store.complete(key, scope, claimId, { statusCode, body })).pipe(map(() => body))),
      catchError((err: unknown) => {
        // Only a definitive HttpException (the handler explicitly rejected this request —
        // validation, a business-rule violation) is cached and replayed verbatim. An
        // unexpected/transient error (a raw throw, a timeout) is not — a retry re-attempting
        // the operation is more likely correct than replaying a possibly-spurious failure
        // forever until the claim goes stale.
        const cache =
          err instanceof HttpException
            ? this.store.complete(key, scope, claimId, { statusCode: err.getStatus(), body: err.getResponse() })
            : Promise.resolve();
        return from(cache).pipe(switchMap(() => throwError(() => err)));
      }),
    );
  }
}
