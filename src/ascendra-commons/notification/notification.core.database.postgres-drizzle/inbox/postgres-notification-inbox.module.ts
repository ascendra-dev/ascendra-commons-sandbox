import { DynamicModule, Module } from '@nestjs/common';
import { NOTIFICATION_INBOX_STORE } from '../../notification.core.database';
import { PostgresNotificationInbox } from './postgres-notification-inbox';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR, POSTGRES_NOTIFICATION_INBOX } from '../tokens';

export interface PostgresNotificationInboxModuleConfig {
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  application: string;
  imports?: DynamicModule['imports'];
}

/**
 * Provides the in-app inbox twice over: `POSTGRES_NOTIFICATION_INBOX` for `NotificationModule.forRoot({ inboxToken })`
 * (where the `in_app` channel delivers), and `NOTIFICATION_INBOX_STORE` for `notification.api`'s inbox endpoints —
 * import this module in both.
 */
@Module({})
export class PostgresNotificationInboxModule {
  static forRoot(config: PostgresNotificationInboxModuleConfig): DynamicModule {
    return {
      module: PostgresNotificationInboxModule,
      imports: config.imports ?? [],
      providers: [
        { provide: NOTIFICATION_ADMIN_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: NOTIFICATION_ADMIN_APPLICATION_ID, useValue: config.application },
        PostgresNotificationInbox,
        { provide: POSTGRES_NOTIFICATION_INBOX, useExisting: PostgresNotificationInbox },
        { provide: NOTIFICATION_INBOX_STORE, useExisting: PostgresNotificationInbox },
      ],
      exports: [POSTGRES_NOTIFICATION_INBOX, NOTIFICATION_INBOX_STORE],
    };
  }
}
