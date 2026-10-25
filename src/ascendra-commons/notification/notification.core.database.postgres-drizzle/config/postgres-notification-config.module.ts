import { DynamicModule, Module } from '@nestjs/common';
import { PostgresNotificationConfig } from './postgres-notification-config';
import {
  NOTIFICATION_CONFIG_OPTIONS,
  NOTIFICATION_CONFIG_SQL_EXECUTOR,
  POSTGRES_NOTIFICATION_CONFIG,
} from '../tokens';

export interface PostgresNotificationConfigModuleConfig {
  /** The injection token the consuming app already provides its Drizzle db client under. Aliased via `useExisting`. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /**
   * Which Ascendra app this process is (e.g. `'ascendra-pay'`) — written on
   * every row and filtered on every read. The same string passed to
   * `DomainEventsModule.forRoot({ application })`.
   */
  application: string;
  /** Config-cache TTL in seconds. Default 30. `0` disables the cache. */
  cacheTtlSeconds?: number;
  /**
   * A tenant with no provider credential of its own sends through the platform's (the `tenant_id` NULL row) instead
   * of failing `no_provider_config` — the usual SaaS shape: the platform's account unless a tenant brings its own.
   * Default `false`. Pass the same value to `PostgresNotificationAdminModule`, so coverage gaps agree.
   */
  tenantCredentialFallback?: boolean;
  /** Whatever module(s) export the provider behind `sqlExecutorToken`. */
  imports?: DynamicModule['imports'];
}

/**
 * Wires `PostgresNotificationConfig` and exports it as
 * `POSTGRES_NOTIFICATION_CONFIG`:
 *
 * ```typescript
 * NotificationModule.forRoot({
 *   configToken: POSTGRES_NOTIFICATION_CONFIG,
 *   imports: [
 *     PostgresNotificationConfigModule.forRoot({
 *       sqlExecutorToken: DATABASE_CONNECTION,
 *       application: 'ascendra-pay',
 *       imports: [DatabaseModule],
 *     }),
 *   ],
 * })
 * ```
 */
@Module({})
export class PostgresNotificationConfigModule {
  static forRoot(config: PostgresNotificationConfigModuleConfig): DynamicModule {
    return {
      module: PostgresNotificationConfigModule,
      imports: config.imports ?? [],
      providers: [
        { provide: NOTIFICATION_CONFIG_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        {
          provide: NOTIFICATION_CONFIG_OPTIONS,
          useValue: {
            application: config.application,
            cacheTtlSeconds: config.cacheTtlSeconds ?? 30,
            tenantCredentialFallback: config.tenantCredentialFallback ?? false,
          },
        },
        PostgresNotificationConfig,
        { provide: POSTGRES_NOTIFICATION_CONFIG, useExisting: PostgresNotificationConfig },
      ],
      exports: [POSTGRES_NOTIFICATION_CONFIG],
    };
  }
}
