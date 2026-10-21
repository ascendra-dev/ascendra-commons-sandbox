import { DynamicModule, Module } from '@nestjs/common';
import { PostgresRateLimitEventRecorder, type PostgresRateLimitEventRecorderOptions } from './postgres-rate-limit-event-recorder';
import {
  POSTGRES_RATE_LIMIT_EVENT_RECORDER,
  RATE_LIMIT_APPLICATION_ID,
  RATE_LIMIT_RECORDER_OPTIONS,
  RATE_LIMIT_SQL_EXECUTOR,
} from '../tokens';

export interface PostgresRateLimitEventRecorderModuleConfig extends PostgresRateLimitEventRecorderOptions {
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  application: string;
  imports?: DynamicModule['imports'];
}

/**
 * Provides `PostgresRateLimitEventRecorder` and exports it as
 * `POSTGRES_RATE_LIMIT_EVENT_RECORDER`. Pass that token — and this module in
 * the same `imports` array — to `RateLimitingThrottlerModule.forRoot()`.
 * Independent of `PostgresRateLimitObservabilityModule` — import either or
 * both; both take the same `sqlExecutorToken` / `application`.
 */
@Module({})
export class PostgresRateLimitEventRecorderModule {
  static forRoot(config: PostgresRateLimitEventRecorderModuleConfig): DynamicModule {
    return {
      module: PostgresRateLimitEventRecorderModule,
      imports: config.imports ?? [],
      providers: [
        { provide: RATE_LIMIT_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: RATE_LIMIT_APPLICATION_ID, useValue: config.application },
        {
          provide: RATE_LIMIT_RECORDER_OPTIONS,
          useValue: { flushIntervalMs: config.flushIntervalMs, maxBufferedKeys: config.maxBufferedKeys },
        },
        PostgresRateLimitEventRecorder,
        { provide: POSTGRES_RATE_LIMIT_EVENT_RECORDER, useExisting: PostgresRateLimitEventRecorder },
      ],
      exports: [POSTGRES_RATE_LIMIT_EVENT_RECORDER],
    };
  }
}
