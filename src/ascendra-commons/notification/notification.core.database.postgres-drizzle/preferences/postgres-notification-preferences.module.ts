import { DynamicModule, Module } from '@nestjs/common';
import { NOTIFICATION_PREFERENCE_STORE } from '../../notification.core.database';
import { PostgresNotificationPreferences } from './postgres-notification-preferences';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR, POSTGRES_NOTIFICATION_PREFERENCES } from '../tokens';

export interface PostgresNotificationPreferencesModuleConfig {
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  application: string;
  imports?: DynamicModule['imports'];
}

/**
 * Provides users' preferences twice over: `POSTGRES_NOTIFICATION_PREFERENCES` for
 * `NotificationModule.forRoot({ preferencesToken })` (what Notifier asks), and `NOTIFICATION_PREFERENCE_STORE` for
 * `notification.api`'s "my preferences" — import this module in both.
 */
@Module({})
export class PostgresNotificationPreferencesModule {
  static forRoot(config: PostgresNotificationPreferencesModuleConfig): DynamicModule {
    return {
      module: PostgresNotificationPreferencesModule,
      imports: config.imports ?? [],
      providers: [
        { provide: NOTIFICATION_ADMIN_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: NOTIFICATION_ADMIN_APPLICATION_ID, useValue: config.application },
        PostgresNotificationPreferences,
        { provide: POSTGRES_NOTIFICATION_PREFERENCES, useExisting: PostgresNotificationPreferences },
        { provide: NOTIFICATION_PREFERENCE_STORE, useExisting: PostgresNotificationPreferences },
      ],
      exports: [POSTGRES_NOTIFICATION_PREFERENCES, NOTIFICATION_PREFERENCE_STORE],
    };
  }
}
