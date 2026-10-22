import { DynamicModule, Module } from '@nestjs/common';
import { PostgresEventDeliveryRecorder, type PostgresEventDeliveryRecorderOptions } from './postgres-event-delivery-recorder';
import {
  EVENT_DELIVERY_APPLICATION_ID,
  EVENT_DELIVERY_RECORDER_OPTIONS,
  EVENT_DELIVERY_SQL_EXECUTOR,
  POSTGRES_EVENT_DELIVERY_RECORDER,
} from '../tokens';

export interface PostgresEventDeliveryRecorderModuleConfig {
  /** The token the consuming app provides its Drizzle db under — the normal pooled connection is fine (a batch INSERT per flush). */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /** Which Ascendra application this process is — stamped on every delivery row. */
  application: string;
  /** How often buffered deliveries are written (default 10s) and how many are held between flushes (default 10,000). */
  flushIntervalMs?: PostgresEventDeliveryRecorderOptions['flushIntervalMs'];
  maxBufferedRows?: PostgresEventDeliveryRecorderOptions['maxBufferedRows'];
  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Provides `PostgresEventDeliveryRecorder` and exports it as
 * `POSTGRES_EVENT_DELIVERY_RECORDER`. Pass that token — and this module in the
 * same `imports` array — to `InProcessDomainEventEmitterModule.forRoot()`:
 *
 * ```typescript
 * InProcessDomainEventEmitterModule.forRoot({
 *   recorderToken: POSTGRES_EVENT_DELIVERY_RECORDER,
 *   imports: [
 *     PostgresEventDeliveryRecorderModule.forRoot({
 *       sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule],
 *     }),
 *   ],
 * })
 * ```
 *
 * Independent of `PostgresEventDeliveryObservabilityModule` — import either or
 * both; both take the same `sqlExecutorToken` / `application`. Requires the
 * `commons_domain_events_delivery` migration, and `app.enableShutdownHooks()` so the buffer is written on deploy.
 */
@Module({})
export class PostgresEventDeliveryRecorderModule {
  static forRoot(config: PostgresEventDeliveryRecorderModuleConfig): DynamicModule {
    return {
      module: PostgresEventDeliveryRecorderModule,
      imports: config.imports ?? [],
      providers: [
        { provide: EVENT_DELIVERY_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: EVENT_DELIVERY_APPLICATION_ID, useValue: config.application },
        {
          provide: EVENT_DELIVERY_RECORDER_OPTIONS,
          useValue: { flushIntervalMs: config.flushIntervalMs, maxBufferedRows: config.maxBufferedRows },
        },
        PostgresEventDeliveryRecorder,
        { provide: POSTGRES_EVENT_DELIVERY_RECORDER, useExisting: PostgresEventDeliveryRecorder },
      ],
      exports: [POSTGRES_EVENT_DELIVERY_RECORDER],
    };
  }
}
