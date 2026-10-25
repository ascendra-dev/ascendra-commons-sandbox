import { DynamicModule, Module } from '@nestjs/common';
import { PostgresNotificationDeduplicator } from './postgres-notification-deduplicator';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR, POSTGRES_NOTIFICATION_DEDUPLICATOR } from '../tokens';

export interface PostgresNotificationDedupeModuleConfig {
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  application: string;
  imports?: DynamicModule['imports'];
}

/**
 * Provides the deduplicator — pass `POSTGRES_NOTIFICATION_DEDUPLICATOR` as `NotificationModule.forRoot({
 * deduplicatorToken })`, with this module in the same `imports`. Prune expired keys with
 * `PostgresNotificationRetentionService.pruneDedupeKeys()`.
 */
@Module({})
export class PostgresNotificationDedupeModule {
  static forRoot(config: PostgresNotificationDedupeModuleConfig): DynamicModule {
    return {
      module: PostgresNotificationDedupeModule,
      imports: config.imports ?? [],
      providers: [
        { provide: NOTIFICATION_ADMIN_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: NOTIFICATION_ADMIN_APPLICATION_ID, useValue: config.application },
        PostgresNotificationDeduplicator,
        { provide: POSTGRES_NOTIFICATION_DEDUPLICATOR, useExisting: PostgresNotificationDeduplicator },
      ],
      exports: [POSTGRES_NOTIFICATION_DEDUPLICATOR],
    };
  }
}
