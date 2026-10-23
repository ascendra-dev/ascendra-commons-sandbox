/**
 * Request shapes for `authorization.api`. Plain interfaces — `ascendra-commons` carries no validation library; the
 * services validate every field (`shared/params.ts`) and apply the actor-scoped rules. Typed `unknown` where a client
 * may send anything.
 */

/** `POST /authz/users/:userId/roles`. */
export interface AssignRoleBody {
  roleId: unknown;
  /** Omit for your own tenant; `null` = every tenant (a global assignment — platform admins only). */
  tenantId?: unknown;
  /** ISO 8601, in the future — when the role stops applying. Omit for no expiry. */
  expiresAt?: unknown;
}

/** `POST /authz/roles/:roleId/holders` — one role to many users. */
export interface BulkAssignBody {
  userIds: unknown;
  tenantId?: unknown;
  expiresAt?: unknown;
}

/** `DELETE /authz/users/:userId/roles/:roleId?tenantId=…` (or `?global=true` for the all-tenant assignment). */
export interface RevokeRoleQuery {
  tenantId?: string;
  global?: string;
}

export interface SetActionDescriptionBody {
  description: unknown;
}

/** `POST /authz/delegations`. */
export interface CreateDelegationBody {
  granteeId: unknown;
  /** Omit to use the caller's own tenant; if given it must equal the caller's tenant. */
  tenantId?: unknown;
  actions: unknown;
  /** ISO-8601, in the future, within the configured maximum. */
  expiresAt: unknown;
  reason?: unknown;
}

/** `GET /authz/assignments`. */
export interface AssignmentListQuery {
  userId?: string;
  roleId?: string;
  tenantId?: string;
  /** `true` — global (all-tenant) assignments only. */
  global?: string;
  status?: string;
  /** Active assignments expiring within, e.g. `7d`. */
  expiring?: string;
  limit?: string;
  cursor?: string;
}

/** `GET /authz/delegations`. */
export interface DelegationListQuery {
  granterId?: string;
  granteeId?: string;
  /** Either party. */
  userId?: string;
  tenantId?: string;
  status?: string;
  limit?: string;
  cursor?: string;
}

export interface ExplainAccessQuery {
  userId?: string;
  tenantId?: string;
  action?: string;
}

export interface WhoCanQuery {
  action?: string;
  tenantId?: string;
}
