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

interface MinimalRequest {
  route?: { path?: string };
  url?: string;
  headers: Record<string, string | string[] | undefined>;
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
      await this.recorder.recordRejection({
        // The route *pattern* (e.g. '/pay/:token'), never the resolved URL with
        // real ids in it — request.route is set by the underlying HTTP adapter
        // (Express/Fastify) after routing; request.url is the fallback when
        // that isn't populated (some test harnesses, non-HTTP adapters).
        route: request.route?.path ?? request.url ?? 'unknown',
        identifier: detail.tracker,
        limit: detail.limit,
        ttlMs: detail.ttl,
        correlationId: typeof correlationHeader === 'string' ? correlationHeader : undefined,
      });
    } catch (err) {
      this.recordLogger.error(
        'Failed to record a rate-limit rejection — the 429 itself is unaffected',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
