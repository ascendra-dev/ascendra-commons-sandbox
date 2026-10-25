import { DynamicModule, Module } from '@nestjs/common';
import { NOTIFICATION_API_OPTIONS, NOTIFICATION_AUDIT_EMITTER, NOTIFICATION_TENANT_DIRECTORY } from './tokens';
import { resolveNotificationApiOptions, type NotificationApiModuleConfig } from './notification-api.options';
import { NoopNotificationAuditEmitter } from './notification-audit.port';
import { NotificationObservabilityApiService } from './observability/notification-observability-api.service';
import { NotificationObservabilityController } from './observability/notification-observability.controller';
import { NotificationConfigAdminApiService } from './config-admin/notification-config-admin-api.service';
import { NotificationConfigAdminController } from './config-admin/notification-config-admin.controller';
import { NotificationTestSendApiService } from './test-send/notification-test-send-api.service';
import { NotificationTestSendController } from './test-send/notification-test-send.controller';
import { NotificationTypeCatalog } from './types/notification-type-catalog';
import { NotificationTypesApiService } from './types/notification-types-api.service';
import { NotificationTypesController } from './types/notification-types.controller';
import { NotificationSuppressionsApiService } from './suppressions/notification-suppressions-api.service';
import { NotificationSuppressionsController } from './suppressions/notification-suppressions.controller';
import { NotificationPreferencesApiService } from './preferences/notification-preferences-api.service';
import { NotificationPreferencesController } from './preferences/notification-preferences.controller';
import { NotificationInboxApiService } from './inbox/notification-inbox-api.service';
import { NotificationInboxController } from './inbox/notification-inbox.controller';
import { NotificationRetryApiService } from './retry/notification-retry-api.service';
import { NotificationRetryController } from './retry/notification-retry.controller';

/**
 * HTTP endpoints for a notification admin / observability UI, over the
 * `notification.core.database` ports + `Notifier`. Opt-in, stack-agnostic — it
 * depends on `NOTIFICATION_OBSERVABILITY_PORT` / `NOTIFICATION_CONFIG_ADMIN_PORT`
 * / `NOTIFIER` (brought in via `imports`), never on a stack adapter directly.
 *
 * Requires `AuthorizationGuard` wired globally as `APP_GUARD` — the endpoints
 * declare `@RequiresAction('notification.*')`. Audit is opt-in via
 * `auditEmitterToken`.
 *
 * ```typescript
 * NotificationApiModule.forRoot({
 *   auditEmitterToken: MY_AUDIT_EMITTER,        // optional
 *   imports: [
 *     PostgresNotificationAdminModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
 *     // NotificationModule.forRoot(...) exports NOTIFIER — import it here too if it isn't otherwise visible.
 *   ],
 * })
 * ```
 */
@Module({})
export class NotificationApiModule {
  static forRoot(config: NotificationApiModuleConfig = {}): DynamicModule {
    return {
      module: NotificationApiModule,
      imports: config.imports ?? [],
      controllers: [
        NotificationObservabilityController,
        NotificationConfigAdminController,
        NotificationTestSendController,
        NotificationTypesController,
        NotificationSuppressionsController,
        NotificationPreferencesController,
        NotificationInboxController,
        NotificationRetryController,
      ],
      providers: [
        { provide: NOTIFICATION_API_OPTIONS, useValue: resolveNotificationApiOptions(config) },
        config.auditEmitterToken
          ? { provide: NOTIFICATION_AUDIT_EMITTER, useExisting: config.auditEmitterToken }
          : { provide: NOTIFICATION_AUDIT_EMITTER, useClass: NoopNotificationAuditEmitter },
        NotificationObservabilityApiService,
        NotificationConfigAdminApiService,
        NotificationTestSendApiService,
        NotificationTypeCatalog,
        ...(config.tenantDirectoryToken ? [{ provide: NOTIFICATION_TENANT_DIRECTORY, useExisting: config.tenantDirectoryToken }] : []),
        NotificationTypesApiService,
        NotificationSuppressionsApiService,
        NotificationPreferencesApiService,
        NotificationInboxApiService,
        NotificationRetryApiService,
      ],
    };
  }
}
