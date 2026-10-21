import { DynamicModule, Module } from '@nestjs/common';
import type { IdempotencyApiModuleConfig } from './idempotency-api.options';
import { IdempotencyApiService } from './idempotency-api.service';
import { IdempotencyController } from './idempotency.controller';

/**
 * HTTP read endpoints for an idempotency support/ops screen, over
 * `IDEMPOTENCY_OBSERVABILITY_PORT`. Opt-in, stack-agnostic — depends on the
 * port (brought in via `imports`), never on a stack adapter directly.
 * Read-only: claims are written only by `IdempotencyStore`, so there is no
 * mutation surface here.
 *
 * Requires `AuthorizationGuard` wired globally as `APP_GUARD` — the endpoints
 * declare `@RequiresAction('idempotency.view')`.
 *
 * ```typescript
 * IdempotencyApiModule.forRoot({
 *   imports: [
 *     PostgresIdempotencyObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
 *   ],
 * })
 * ```
 */
@Module({})
export class IdempotencyApiModule {
  static forRoot(config: IdempotencyApiModuleConfig = {}): DynamicModule {
    return {
      module: IdempotencyApiModule,
      imports: config.imports ?? [],
      controllers: [IdempotencyController],
      providers: [IdempotencyApiService],
    };
  }
}
