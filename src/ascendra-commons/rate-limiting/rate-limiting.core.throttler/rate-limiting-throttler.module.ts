import { DynamicModule, Module, Provider } from '@nestjs/common';
import { NoopRateLimitEventRecorder, RATE_LIMIT_EVENT_RECORDER } from '../rate-limiting.core';
import { RecordingThrottlerGuard } from './recording-throttler.guard';

export interface RateLimitingThrottlerModuleConfig {
  /**
   * Token a `RateLimitEventRecorder` implementation is provided under (e.g.
   * `POSTGRES_RATE_LIMIT_EVENT_RECORDER`). Omit and every rejection goes
   * unrecorded (`NoopRateLimitEventRecorder`) — throttling itself is
   * unaffected either way.
   */
  recorderToken?: string | symbol | (new (...args: never[]) => unknown);
  /** Whatever module(s) export the provider behind `recorderToken`. */
  imports?: DynamicModule['imports'];
}

/**
 * Provides `RecordingThrottlerGuard`. This module does **not** call
 * `ThrottlerModule.forRoot()` itself — the actual limits (which routes, what
 * `limit`/`ttl`) stay a project decision, declared via `@Throttle()` at each
 * endpoint exactly as `@nestjs/throttler` already works. Import this
 * alongside the project's own `ThrottlerModule.forRoot()`, then register the
 * guard as `APP_GUARD` in place of the plain `ThrottlerGuard`:
 *
 * ```typescript
 * @Module({
 *   imports: [
 *     ThrottlerModule.forRoot({ throttlers: [{ limit: 20, ttl: 60_000 }] }),
 *     RateLimitingThrottlerModule.forRoot({
 *       recorderToken: POSTGRES_RATE_LIMIT_EVENT_RECORDER,   // optional
 *       imports: [PostgresRateLimitEventRecorderModule.forRoot({ ... })],
 *     }),
 *   ],
 *   providers: [{ provide: APP_GUARD, useExisting: RecordingThrottlerGuard }],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class RateLimitingThrottlerModule {
  static forRoot(config: RateLimitingThrottlerModuleConfig = {}): DynamicModule {
    const recorderProvider: Provider = config.recorderToken
      ? { provide: RATE_LIMIT_EVENT_RECORDER, useExisting: config.recorderToken }
      : { provide: RATE_LIMIT_EVENT_RECORDER, useClass: NoopRateLimitEventRecorder };

    return {
      module: RateLimitingThrottlerModule,
      imports: config.imports ?? [],
      providers: [recorderProvider, RecordingThrottlerGuard],
      exports: [RecordingThrottlerGuard],
    };
  }
}
