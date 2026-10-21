import { DynamicModule, Module } from '@nestjs/common';
import { RATE_LIMIT_OBSERVABILITY_PORT } from '../../rate-limiting.core';
import { PostgresRateLimitObservabilityService } from './postgres-rate-limit-observability.service';
import { RATE_LIMIT_APPLICATION_ID, RATE_LIMIT_SQL_EXECUTOR } from '../tokens';

export interface PostgresRateLimitObservabilityModuleConfig {
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  application: string;
  imports?: DynamicModule['imports'];
}

/**
 * Read-only reporting over `commons_rate_limit_rejection` — binds
 * `PostgresRateLimitObservabilityService` under the core
 * `RATE_LIMIT_OBSERVABILITY_PORT` token, so `rate-limiting.api` (or your own
 * controller) depends on the port, not on Postgres.
 */
@Module({})
export class PostgresRateLimitObservabilityModule {
  static forRoot(config: PostgresRateLimitObservabilityModuleConfig): DynamicModule {
    return {
      module: PostgresRateLimitObservabilityModule,
      imports: config.imports ?? [],
      providers: [
        { provide: RATE_LIMIT_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: RATE_LIMIT_APPLICATION_ID, useValue: config.application },
        PostgresRateLimitObservabilityService,
        { provide: RATE_LIMIT_OBSERVABILITY_PORT, useExisting: PostgresRateLimitObservabilityService },
      ],
      exports: [RATE_LIMIT_OBSERVABILITY_PORT],
    };
  }
}
