import { DynamicModule, Module } from '@nestjs/common';
import { PostgresEventDeliveryRetentionService } from './postgres-event-delivery-retention.service';
import { EVENT_DELIVERY_APPLICATION_ID, EVENT_DELIVERY_SQL_EXECUTOR } from '../tokens';

export interface PostgresEventDeliveryRetentionModuleConfig {
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  application: string;
  imports?: DynamicModule['imports'];
}

/**
 * Provides and exports `PostgresEventDeliveryRetentionService` — inject it into the
 * project's own scheduled job. Independent of the recorder and observability
 * modules; all three take the same `sqlExecutorToken` / `application`.
 */
@Module({})
export class PostgresEventDeliveryRetentionModule {
  static forRoot(config: PostgresEventDeliveryRetentionModuleConfig): DynamicModule {
    return {
      module: PostgresEventDeliveryRetentionModule,
      imports: config.imports ?? [],
      providers: [
        { provide: EVENT_DELIVERY_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: EVENT_DELIVERY_APPLICATION_ID, useValue: config.application },
        PostgresEventDeliveryRetentionService,
      ],
      exports: [PostgresEventDeliveryRetentionService],
    };
  }
}
