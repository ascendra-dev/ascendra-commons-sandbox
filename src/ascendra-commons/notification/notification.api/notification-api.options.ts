import type { DynamicModule } from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';

/**
 * The `@RequiresAction` gate names `notification.api`'s endpoints declare.
 * Fixed (not `forRoot`-configurable) — `@RequiresAction` is applied at
 * class-definition time. A vertical whose catalog uses different names maps its
 * admin role to *also* grant these.
 */
export const NOTIFICATION_ACTIONS = {
  /** Read the delivery log + config-coverage gaps + list config rows. */
  VIEW: 'notification.view',
  /**
   * Read a delivery's stored rendered message and the variables behind it — names, amounts, addresses. Its own action
   * (as `idempotency.view-response` is), so seeing *that* a message went out doesn't mean reading it; every read is
   * audited.
   */
  VIEW_CONTENT: 'notification.view_content',
  /** Create / delete routing, template and credential rows. */
  MANAGE_CONFIG: 'notification.manage_config',
  /** Fire a real test notification via `Notifier.notify()`. */
  TEST_SEND: 'notification.test_send',
  /** Resend a failed delivery to its real recipient — `POST /notifications/deliveries/:id/retry`. */
  RETRY: 'notification.retry',
} as const;

export interface NotificationApiModuleConfig {
  /**
   * Modules exporting `NOTIFICATION_OBSERVABILITY_PORT`,
   * `NOTIFICATION_CONFIG_ADMIN_PORT` (from a stack adapter's
   * `PostgresNotificationAdminModule`) and `NOTIFIER` (from
   * `NotificationModule.forRoot`).
   */
  imports?: DynamicModule['imports'];
  /**
   * Optional token a `NotificationTenantDirectory` is provided under (bound in `imports`) — every tenant the coverage
   * gaps check default routes for. Omit → the tenants the config names.
   */
  tenantDirectoryToken?: string | symbol | (new (...args: never[]) => unknown);
  /** Optional token a `NotificationAuditEmitter` is provided under (bound in `imports`). Omit → mutations are not audited. */
  auditEmitterToken?: string | symbol | (new (...args: never[]) => unknown);
  /**
   * Is this actor a platform admin (may edit deployment-default `tenant_id IS NULL`
   * rows, and any tenant's rows)? Default: `actor.tenantId === null`.
   */
  isPlatformAdmin?: (actor: Actor) => boolean | Promise<boolean>;
}

/** The shape bound under `NOTIFICATION_API_OPTIONS`. */
export interface NotificationApiOptions {
  isPlatformAdmin: (actor: Actor) => boolean | Promise<boolean>;
}

export function resolveNotificationApiOptions(config: NotificationApiModuleConfig): NotificationApiOptions {
  return {
    isPlatformAdmin: config.isPlatformAdmin ?? ((actor) => actor.tenantId === null),
  };
}
