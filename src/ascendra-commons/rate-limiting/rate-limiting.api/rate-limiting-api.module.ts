import { DynamicModule, Module } from '@nestjs/common';
import type { RateLimitingApiModuleConfig } from './rate-limiting-api.options';
import { RateLimitingApiService } from './rate-limiting-api.service';
import { RateLimitingController } from './rate-limiting.controller';

/**
 * HTTP read endpoints for a rate-limiting security/ops screen, over
 * `RATE_LIMIT_OBSERVABILITY_PORT`. Opt-in, stack-agnostic. Read-only.
 *
 * Requires `AuthorizationGuard` wired globally as `APP_GUARD` — the endpoints
 * declare `@RequiresAction('rate-limit.view')`.
 *
 * ```typescript
 * RateLimitingApiModule.forRoot({
 *   imports: [PostgresRateLimitObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
 * })
 * ```
 */
@Module({})
export class RateLimitingApiModule {
  static forRoot(config: RateLimitingApiModuleConfig = {}): DynamicModule {
    return {
      module: RateLimitingApiModule,
      imports: config.imports ?? [],
      controllers: [RateLimitingController],
      providers: [RateLimitingApiService],
    };
  }
}
