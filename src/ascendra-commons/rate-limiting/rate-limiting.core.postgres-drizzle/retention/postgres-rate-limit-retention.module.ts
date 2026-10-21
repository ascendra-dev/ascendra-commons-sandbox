import { DynamicModule, Module } from '@nestjs/common';
import { PostgresRateLimitRetentionService } from './postgres-rate-limit-retention.service';
import { RATE_LIMIT_APPLICATION_ID, RATE_LIMIT_SQL_EXECUTOR } from '../tokens';

export interface PostgresRateLimitRetentionModuleConfig {
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  application: string;
  imports?: DynamicModule['imports'];
}

/**
 * Provides and exports `PostgresRateLimitRetentionService` — inject it into the
 * project's own scheduled job. Independent of the recorder and observability
 * modules; all three take the same `sqlExecutorToken` / `application`.
 */
@Module({})
export class PostgresRateLimitRetentionModule {
  static forRoot(config: PostgresRateLimitRetentionModuleConfig): DynamicModule {
    return {
      module: PostgresRateLimitRetentionModule,
      imports: config.imports ?? [],
      providers: [
        { provide: RATE_LIMIT_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: RATE_LIMIT_APPLICATION_ID, useValue: config.application },
        PostgresRateLimitRetentionService,
      ],
      exports: [PostgresRateLimitRetentionService],
    };
  }
}
