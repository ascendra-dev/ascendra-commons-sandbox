import type { DynamicModule } from '@nestjs/common';
import type { Actor } from '../authorization.core';

/**
 * The `@RequiresAction` gate names `authorization.api`'s endpoints declare — fixed, `@RequiresAction` is applied at
 * class-definition time. A vertical whose catalog uses different names grants its admin roles these too.
 */
export const AUTHZ_ACTIONS = {
  /** Read the console: roles, assignments, delegations, explain, who-can, the catalog. */
  VIEW: 'authz.view',
  /** Assign and revoke roles — within the ceiling (see `AuthzAccessScope`). */
  ASSIGN_ROLES: 'authz.assign_roles',
  /** Lend your own actions to another user in your tenant, and revoke what you lent. */
  MANAGE_DELEGATIONS: 'authz.manage_delegations',
  /** Describe actions in the catalog (platform admins only). */
  MANAGE_CATALOG: 'authz.manage_catalog',
  /**
   * Act across tenants in this console — read every tenant's access, make global (all-tenant) assignments, assign
   * roles holding platform-scope actions. Platform-scope itself: only a global assignment can grant it.
   */
  PLATFORM: 'authz.platform',
} as const;

export interface AuthzApiModuleConfig {
  /**
   * Modules exporting `AUTHZ_ADMIN_PORT` + `AUTHZ_OBSERVABILITY_PORT` (`PostgresAuthzAdminModule`) and
   * `PERMISSION_TABLE_AUTHORIZER` + `AUTHZ_DELEGATION_SERVICE` (`PostgresPermissionTableModule`) — and optionally an
   * `AUTHZ_USER_DIRECTORY`, and `ACCESS_DENIAL_OBSERVABILITY_PORT` (`PostgresAccessDenialObservabilityModule`) for the
   * denied-requests log.
   */
  imports?: DynamicModule['imports'];
  /**
   * Optional token an `AuthzUserDirectory` is provided under (bound in `imports`) — who the users are. Without it the
   * people endpoints (`/authz/users*`) answer 501; everything else works on ids.
   */
  userDirectoryToken?: string | symbol | (new (...args: never[]) => unknown);
  /** Optional token a `AuthzAuditEmitter` is provided under (bound in `imports`). Omit → changes are not audited. */
  auditEmitterToken?: string | symbol | (new (...args: never[]) => unknown);
  /** The app's action catalog — what `GET /authz/action-catalog/health` compares the table against. */
  actionCatalog: readonly string[];
  /**
   * Override who counts as a platform admin. Default: whoever holds `authz.platform` (`AUTHZ_ACTIONS.PLATFORM`) —
   * asked of the permission-table authorizer. Never "has no tenant": a support persona has none either.
   */
  isPlatformAdmin?: (actor: Actor) => boolean | Promise<boolean>;
}

export interface AuthzApiOptions {
  actionCatalog: readonly string[];
  isPlatformAdmin?: (actor: Actor) => boolean | Promise<boolean>;
}

export function resolveAuthzApiOptions(config: AuthzApiModuleConfig): AuthzApiOptions {
  return { actionCatalog: config.actionCatalog, isPlatformAdmin: config.isPlatformAdmin };
}
