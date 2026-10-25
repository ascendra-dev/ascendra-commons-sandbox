import { DynamicModule, Module } from '@nestjs/common';
import { PostgresNotificationRetentionService } from './postgres-notification-retention.service';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR } from '../tokens';

export interface PostgresNotificationRetentionModuleConfig {
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  application: string;
  imports?: DynamicModule['imports'];
}

/**
 * Provides and exports `PostgresNotificationRetentionService` — inject it into the project's own scheduled job.
 * Independent of the recorder and admin modules; all take the same `sqlExecutorToken` / `application`.
 */
@Module({})
export class PostgresNotificationRetentionModule {
  static forRoot(config: PostgresNotificationRetentionModuleConfig): DynamicModule {
    return {
      module: PostgresNotificationRetentionModule,
      imports: config.imports ?? [],
      providers: [
        { provide: NOTIFICATION_ADMIN_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: NOTIFICATION_ADMIN_APPLICATION_ID, useValue: config.application },
        PostgresNotificationRetentionService,
      ],
      exports: [PostgresNotificationRetentionService],
    };
  }
}
