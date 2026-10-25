import { DynamicModule, Module } from '@nestjs/common';
import { PostgresNotificationSuppressionList } from './postgres-notification-suppression-list';
import {
  NOTIFICATION_ADMIN_APPLICATION_ID,
  NOTIFICATION_ADMIN_SQL_EXECUTOR,
  NOTIFICATION_SUPPRESSION_OPTIONS,
  POSTGRES_NOTIFICATION_SUPPRESSION_LIST,
} from '../tokens';

export interface PostgresNotificationSuppressionModuleConfig {
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  application: string;
  /** Lookup cache TTL. Default 30 s. */
  cacheTtlSeconds?: number;
  imports?: DynamicModule['imports'];
}

/**
 * Provides the suppression list Notifier asks before each send — pass `POSTGRES_NOTIFICATION_SUPPRESSION_LIST` as
 * `NotificationModule.forRoot({ suppressionListToken })`, with this module in the same `imports`. The list is filled
 * by `PostgresNotificationDeliveryRecorder.updateDeliveryStatus({ suppress: true })` and managed through
 * `PostgresNotificationAdminModule`.
 */
@Module({})
export class PostgresNotificationSuppressionModule {
  static forRoot(config: PostgresNotificationSuppressionModuleConfig): DynamicModule {
    return {
      module: PostgresNotificationSuppressionModule,
      imports: config.imports ?? [],
      providers: [
        { provide: NOTIFICATION_ADMIN_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: NOTIFICATION_ADMIN_APPLICATION_ID, useValue: config.application },
        { provide: NOTIFICATION_SUPPRESSION_OPTIONS, useValue: { cacheTtlSeconds: config.cacheTtlSeconds } },
        PostgresNotificationSuppressionList,
        { provide: POSTGRES_NOTIFICATION_SUPPRESSION_LIST, useExisting: PostgresNotificationSuppressionList },
      ],
      exports: [POSTGRES_NOTIFICATION_SUPPRESSION_LIST],
    };
  }
}
