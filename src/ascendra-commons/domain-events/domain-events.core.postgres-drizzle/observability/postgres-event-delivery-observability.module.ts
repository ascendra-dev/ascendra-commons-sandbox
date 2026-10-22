import { DynamicModule, Module } from '@nestjs/common';
import { EVENT_DELIVERY_OBSERVABILITY_PORT } from '../../domain-events.core';
import { PostgresEventDeliveryObservabilityService } from './postgres-event-delivery-observability.service';
import { EVENT_DELIVERY_APPLICATION_ID, EVENT_DELIVERY_SQL_EXECUTOR } from '../tokens';

export interface PostgresEventDeliveryObservabilityModuleConfig {
  /** The token the consuming app provides its Drizzle db under — the normal pooled connection is fine (reads only). */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /** Which Ascendra application this process is — every query is scoped to it. */
  application: string;
  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Read-only reporting over `commons_domain_events_delivery` — binds
 * `PostgresEventDeliveryObservabilityService` under the core
 * `EVENT_DELIVERY_OBSERVABILITY_PORT` token, so `domain-events.api` (or your
 * own controller) depends on the port, not on Postgres.
 *
 * Independent of `PostgresEventDeliveryRecorderModule` — import either or
 * both; both take the same `sqlExecutorToken` / `application`.
 */
@Module({})
export class PostgresEventDeliveryObservabilityModule {
  static forRoot(config: PostgresEventDeliveryObservabilityModuleConfig): DynamicModule {
    return {
      module: PostgresEventDeliveryObservabilityModule,
      imports: config.imports ?? [],
      providers: [
        { provide: EVENT_DELIVERY_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: EVENT_DELIVERY_APPLICATION_ID, useValue: config.application },
        PostgresEventDeliveryObservabilityService,
        { provide: EVENT_DELIVERY_OBSERVABILITY_PORT, useExisting: PostgresEventDeliveryObservabilityService },
      ],
      exports: [EVENT_DELIVERY_OBSERVABILITY_PORT],
    };
  }
}
