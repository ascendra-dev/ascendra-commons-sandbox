import { ExecutionContext, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { NoopRateLimitEventRecorder, RATE_LIMIT_EVENT_RECORDER, type RateLimitEventRecorder } from '../rate-limiting.core';

/**
 * What an inbound correlation id may look like: 1–128 of letters, digits, `.`, `_`, `:` and `-` — a UUID, a W3C trace
 * id, the usual tracing formats (the same rule as audit-logging's CorrelationIdMiddleware). Anything else — overlong,
 * spaces, markup — is the caller's own text: stored, it would sit in the log and the admin screens, and a fresh value
 * per request would split one source's rejections into a row each. So it's dropped, and the rejection still counts.
 */
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

interface MinimalRequest {
  /** Express: the matched route, pattern and all (`/pay/:token`). */
  route?: { path?: string };
  /** Fastify ≥ 4.10: the matched route's pattern. */
  routeOptions?: { url?: string };
  /** Older Fastify. */
  routerPath?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * The route *pattern* the limit was declared on — never the resolved URL, which carries real ids (a payment-link
 * token, in `/pay/<token>`) and the query string: stored, that would put a secret in the log, and make every id its own
 * row. Read from whichever HTTP adapter is in use; when none says (a test harness, a non-HTTP context), the handler —
 * `PaymentLinkController.resolve` — names the route just as well, and holds nothing secret.
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
 * Drop-in replacement for `ThrottlerGuard` — same behavior, same `@Throttle()`
 * declarations, same `429` — plus one thing: every rejection is recorded
 * through the optional `RATE_LIMIT_EVENT_RECORDER` before the exception is
 * thrown. This is the only hook `@nestjs/throttler` exposes for this
 * (`throwThrottlingException()` is `protected`, meant to be overridden), so
 * this subclass exists instead of a separate exception filter, which
 * couldn't see `ThrottlerLimitDetail` (the tracker/limit/ttl) at all.
 *
 * Register this in place of `ThrottlerGuard` as `APP_GUARD` — nothing else
 * about how the project uses `@nestjs/throttler` changes.
 *
 * Recording is best-effort and guarded: a failure to log a rejection never
 * changes whether the request is actually throttled — `throwThrottlingException()`
 * still runs (and the `429` still fires) even if recording itself throws.
 */
@Injectable()
export class RecordingThrottlerGuard extends ThrottlerGuard {
  // Not `logger`: ThrottlerGuard (6.7+) has its own protected `logger`, which this must not shadow.
  private readonly recordLogger = new Logger(RecordingThrottlerGuard.name);
  private readonly recorder: RateLimitEventRecorder;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
    @Optional() @Inject(RATE_LIMIT_EVENT_RECORDER) recorder?: RateLimitEventRecorder,
  ) {
    super(options, storageService, reflector);
    // ThrottlerModule.forRoot() always binds the token when configured; the
    // fallback keeps `new RecordingThrottlerGuard(...)` (tests, ad hoc
    // wiring) working — same pattern as every other recorder in this library.
    this.recorder = recorder ?? new NoopRateLimitEventRecorder();
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    await this.recordRejection(context, throttlerLimitDetail);
    return super.throwThrottlingException(context, throttlerLimitDetail);
  }

  private async recordRejection(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    try {
      const request = context.switchToHttp().getRequest<MinimalRequest>();
      const correlationHeader = request.headers['x-correlation-id'];
      const correlationId =
        typeof correlationHeader === 'string' && CORRELATION_ID.test(correlationHeader) ? correlationHeader : undefined;
      await this.recorder.recordRejection({
        route: routePattern(request, context),
        identifier: detail.tracker,
        limit: detail.limit,
        ttlMs: detail.ttl,
        correlationId,
      });
    } catch (err) {
      this.recordLogger.error(
        'Failed to record a rate-limit rejection — the 429 itself is unaffected',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
