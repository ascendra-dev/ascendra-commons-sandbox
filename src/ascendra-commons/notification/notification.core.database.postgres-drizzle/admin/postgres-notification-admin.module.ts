import { DynamicModule, Module } from '@nestjs/common';
import {
  NOTIFICATION_CONFIG_ADMIN_PORT,
  NOTIFICATION_OBSERVABILITY_PORT,
} from '../../notification.core.database';
import { PostgresNotificationConfigAdminService } from './postgres-notification-config-admin.service';
import { PostgresNotificationObservabilityService } from './postgres-notification-observability.service';
import {
  NOTIFICATION_ADMIN_APPLICATION_ID,
  NOTIFICATION_ADMIN_CREDENTIAL_FALLBACK,
  NOTIFICATION_ADMIN_SQL_EXECUTOR,
} from '../tokens';

export interface PostgresNotificationAdminModuleConfig {
  /** The token the consuming app provides its Drizzle db under — a normal pooled connection. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /** Which Ascendra application this process is — every query/write is scoped to it. */
  application: string;
  /** The same value given to `PostgresNotificationConfigModule` — so a tenant covered by the platform's credential isn't a gap. */
  tenantCredentialFallback?: boolean;
  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * The notification admin screen's backend, bound under the family port tokens so
 * `notification.api` (or your own controllers) depend on
 * `NOTIFICATION_OBSERVABILITY_PORT` / `NOTIFICATION_CONFIG_ADMIN_PORT` without
 * knowing Postgres is underneath.
 *
 * Independent of `PostgresNotificationConfigModule` (the config *reader*) and
 * `PostgresNotificationDeliveryRecorderModule` (the write path) — import
 * whichever you need; all take the same `sqlExecutorToken` / `application`.
 */
@Module({})
export class PostgresNotificationAdminModule {
  static forRoot(config: PostgresNotificationAdminModuleConfig): DynamicModule {
    return {
      module: PostgresNotificationAdminModule,
      imports: config.imports ?? [],
      providers: [
        { provide: NOTIFICATION_ADMIN_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: NOTIFICATION_ADMIN_APPLICATION_ID, useValue: config.application },
        { provide: NOTIFICATION_ADMIN_CREDENTIAL_FALLBACK, useValue: config.tenantCredentialFallback ?? false },
        PostgresNotificationObservabilityService,
        { provide: NOTIFICATION_OBSERVABILITY_PORT, useExisting: PostgresNotificationObservabilityService },
        PostgresNotificationConfigAdminService,
        { provide: NOTIFICATION_CONFIG_ADMIN_PORT, useExisting: PostgresNotificationConfigAdminService },
      ],
      exports: [NOTIFICATION_OBSERVABILITY_PORT, NOTIFICATION_CONFIG_ADMIN_PORT],
    };
  }
}
