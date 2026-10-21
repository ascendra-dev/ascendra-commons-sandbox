import { DynamicModule, Module } from '@nestjs/common';
import { IDEMPOTENCY_OBSERVABILITY_PORT } from '../../idempotency-key.core';
import { PostgresIdempotencyObservabilityService } from './postgres-idempotency-observability.service';
import { IDEMPOTENCY_SQL_EXECUTOR } from '../tokens';

export interface PostgresIdempotencyObservabilityModuleConfig {
  /** The token the consuming app provides its Drizzle db under — the normal pooled connection is fine (reads only). */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Read-only reporting over `commons_idempotency_key` — binds
 * `PostgresIdempotencyObservabilityService` under the core
 * `IDEMPOTENCY_OBSERVABILITY_PORT` token, so `idempotency-key.api` (or your
 * own controller) depends on the port, not on Postgres.
 *
 * Independent of `PostgresIdempotencyStoreModule` — import either or both;
 * both take the same `sqlExecutorToken`. No `application` config — this
 * module has none (see the root README).
 */
@Module({})
export class PostgresIdempotencyObservabilityModule {
  static forRoot(config: PostgresIdempotencyObservabilityModuleConfig): DynamicModule {
    return {
      module: PostgresIdempotencyObservabilityModule,
      imports: config.imports ?? [],
      providers: [
        { provide: IDEMPOTENCY_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        PostgresIdempotencyObservabilityService,
        { provide: IDEMPOTENCY_OBSERVABILITY_PORT, useExisting: PostgresIdempotencyObservabilityService },
      ],
      exports: [IDEMPOTENCY_OBSERVABILITY_PORT],
    };
  }
}
