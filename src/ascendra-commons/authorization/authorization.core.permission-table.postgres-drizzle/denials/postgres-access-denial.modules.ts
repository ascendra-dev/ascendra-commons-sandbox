import { DynamicModule, Module } from '@nestjs/common';
import { ACCESS_DENIAL_OBSERVABILITY_PORT } from '../../authorization.core.permission-table';
import { DENIAL_APPLICATION_ID, DENIAL_RECORDER_OPTIONS, DENIAL_SQL_EXECUTOR, POSTGRES_ACCESS_DENIAL_RECORDER } from '../tokens';
import { PostgresAccessDenialObservabilityService, PostgresAccessDenialRetention } from './postgres-access-denial-observability.service';
import { PostgresAccessDenialRecorder, type PostgresAccessDenialRecorderOptions } from './postgres-access-denial-recorder';

type Token = string | symbol | (new (...args: never[]) => unknown);

export interface PostgresAccessDenialModuleConfig {
  sqlExecutorToken: Token;
  /** Which app's denials — stamped on write, scoped on every read and the prune. */
  application: string;
  imports?: DynamicModule['imports'];
}

/**
 * The denied-requests recorder — export `POSTGRES_ACCESS_DENIAL_RECORDER` to
 * `AuthorizationModule.forRoot({ denialRecorderToken, imports: [this] })`. One instance per app: it holds the buffer.
 */
@Module({})
export class PostgresAccessDenialRecorderModule {
  static forRoot(config: PostgresAccessDenialModuleConfig & PostgresAccessDenialRecorderOptions): DynamicModule {
    return {
      module: PostgresAccessDenialRecorderModule,
      imports: config.imports ?? [],
      providers: [
        { provide: DENIAL_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: DENIAL_APPLICATION_ID, useValue: config.application },
        {
          provide: DENIAL_RECORDER_OPTIONS,
          useValue: {
            flushIntervalMs: config.flushIntervalMs,
            maxBufferedKeys: config.maxBufferedKeys,
            correlationIdResolver: config.correlationIdResolver,
          },
        },
        PostgresAccessDenialRecorder,
        { provide: POSTGRES_ACCESS_DENIAL_RECORDER, useExisting: PostgresAccessDenialRecorder },
      ],
      exports: [POSTGRES_ACCESS_DENIAL_RECORDER],
    };
  }
}

/** The denied-requests log's reads (`ACCESS_DENIAL_OBSERVABILITY_PORT`, for `authorization.api`) and its retention. */
@Module({})
export class PostgresAccessDenialObservabilityModule {
  static forRoot(config: PostgresAccessDenialModuleConfig): DynamicModule {
    return {
      module: PostgresAccessDenialObservabilityModule,
      imports: config.imports ?? [],
      providers: [
        { provide: DENIAL_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: DENIAL_APPLICATION_ID, useValue: config.application },
        PostgresAccessDenialObservabilityService,
        { provide: ACCESS_DENIAL_OBSERVABILITY_PORT, useExisting: PostgresAccessDenialObservabilityService },
        PostgresAccessDenialRetention,
      ],
      exports: [ACCESS_DENIAL_OBSERVABILITY_PORT, PostgresAccessDenialRetention],
    };
  }
}
