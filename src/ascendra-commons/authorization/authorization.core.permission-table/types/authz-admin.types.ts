/**
 * DTOs for the authorization admin/observability surface — the answer-shapes
 * every stack adapter returns and `authorization.api` serves. Read-shaped for a
 * UI; stack-agnostic (no SQL, no ORM types).
 */

import type { DelegationStatus } from './delegation.types';

/**
 * Where an action may be granted. `tenant` — it acts on one tenant's data, so a role holding it can be assigned in a
 * tenant. `platform` — it reads or changes every tenant's (a rate-limit log, running a job, acting across tenants in
 * this console), so only a global assignment — by a platform admin — may grant it. Declared by the app with the
 * catalog (`syncActions`); `tenant` when it says nothing.
 */
export type ActionScope = 'platform' | 'tenant';

export interface RoleView {
  id: string;
  description: string | null;
  /** When true, the role grants every action and `actions` is empty. */
  grantsAll: boolean;
  actions: string[];
  /** `platform` when the role grants every action or any platform-scope one — it can only be assigned globally. */
  scope: ActionScope;
  /** The platform-scope actions among `actions` — why a role is `platform`. */
  platformActions: string[];
}

/** One action in the catalog, with the roles that grant it. */
export interface ActionView {
  name: string;
  description: string | null;
  scope: ActionScope;
  /** Roles granting it directly — a `grantsAll` role grants it too, without being listed. */
  roleIds: string[];
}

export type AssignmentStatus = 'active' | 'expired';

export interface UserRoleAssignment {
  userId: string;
  /** `null` = the role applies in every tenant (a global, platform assignment). */
  tenantId: string | null;
  roleId: string;
  grantedAt: Date;
  grantedBy: string | null;
  /** When the role stops applying — `null` for an assignment that doesn't expire. */
  expiresAt: Date | null;
  status: AssignmentStatus;
}

export interface AssignmentQuery {
  userId?: string;
  /** Any of these users — e.g. one page of a user list. */
  userIds?: readonly string[];
  /** `null` = global assignments only; omitted = every tenant's and the global ones. */
  tenantId?: string | null;
  roleId?: string;
  status?: AssignmentStatus;
  /** Only active assignments expiring within this many days from now. */
  expiringWithinDays?: number;
  /** Default 100, capped at 500. */
  limit?: number;
  /** Opaque — the previous page's `nextCursor`. */
  cursor?: string;
}

export interface AssignmentPage {
  assignments: UserRoleAssignment[];
  nextCursor?: string;
}

export interface DelegationView {
  id: string;
  granterId: string;
  granteeId: string;
  tenantId: string;
  actions: string[];
  /**
   * Actions the granter no longer holds from a role — a delegation lends only what its granter still has, checked at
   * every use, so these grant nothing now (they come back if the granter gets the action back).
   */
  lapsedActions: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  reason: string | null;
  createdAt: Date;
  createdBy: string;
  status: DelegationStatus;
}

export interface DelegationQuery {
  granterId?: string;
  granteeId?: string;
  /** Either party — granter or grantee. */
  userId?: string;
  tenantId?: string;
  status?: DelegationStatus;
  /** Only active delegations lending at least one action their granter no longer holds. */
  lapsed?: boolean;
  /** Only unrevoked delegations expiring within this many days from now (`GET /authz/delegations/expiring`). Combine with other filters as needed. */
  expiringWithinDays?: number;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. */
  cursor?: string;
}

export interface DelegationPage {
  delegations: DelegationView[];
  nextCursor?: string;
}

/**
 * "Why can (or can't) this user do X?" — the resolution `PermissionTableAuthorizer`
 * performs, made visible. `roles` are the user's active role assignments applicable in `tenantId`
 * (tenant-scoped + global); `delegations` the active delegations granted to them
 * there, each with what it still grants. `effectiveActions` is `'*'` when any role grants all.
 * When `action` is given, `allowed` + `reason` answer for that one action.
 */
export interface AccessExplanation {
  userId: string;
  tenantId: string | null;
  roles: Array<{
    roleId: string;
    tenantId: string | null;
    grantsAll: boolean;
    grantedActions: string[];
    expiresAt: Date | null;
  }>;
  delegations: Array<{
    id: string;
    granterId: string;
    /** What it still grants — the granter's lapsed actions are left out. */
    actions: string[];
    lapsedActions: string[];
    expiresAt: Date;
  }>;
  effectiveActions: string[] | '*';
  action?: string;
  allowed?: boolean;
  reason?: string;
}

/** A role plus how many distinct users actively hold it (`GET /authz/roles/:id`). */
export interface RoleDetail extends RoleView {
  holderCount: number;
}

/** One role that grants the action, with its active holders (scoped to the tenant when one was given). */
export interface WhoCanRoleGrant {
  roleId: string;
  grantsAll: boolean;
  holderUserIds: string[];
}

/** One active delegation that still grants the action. */
export interface WhoCanDelegationGrant {
  id: string;
  granterId: string;
  granteeId: string;
  expiresAt: Date;
}

/** `GET /authz/who-can` — the reverse of `explainAccess`. */
export interface WhoCanResult {
  action: string;
  tenantId: string | null;
  roles: WhoCanRoleGrant[];
  delegations: WhoCanDelegationGrant[];
}

/** Action-catalog drift + documentation gaps (`GET /authz/action-catalog/health`). */
export interface ActionCatalogHealth {
  /** In the app's code catalog but missing from `commons_authz_action` — run `syncActions()`. */
  inCodeNotInDb: string[];
  /** In the table but not in code — renamed or removed; verify, then delete the row. */
  inDbNotInCode: string[];
  /** Granted by at least one role but with no description — what an admin sees in the role screens. */
  grantedButUndescribed: string[];
  describedCount: number;
  totalCount: number;
}

/**
 * Access posture for the Overview (`GET /authz/stats`) — one tenant's own assignments and delegations when given, else
 * every tenant's. Active assignments only.
 */
export interface AccessStats {
  tenantId: string | null;
  /** Distinct users holding at least one active role in the tenant (anywhere, when none is given). */
  usersWithRole: number;
  /** Per role: distinct active holders. Roles nobody holds are left out. */
  roleHolders: Array<{ roleId: string; holders: number }>;
  /** Distinct users holding a role that grants every action or a platform-scope one — globally assigned, so they reach every tenant. */
  platformHolders: number;
  activeDelegations: number;
  /** Active delegations that lend at least one action their granter no longer holds. */
  lapsedDelegations: number;
  delegationsExpiring7d: number;
  assignmentsExpiring7d: number;
}

/** An active assignment of a role that grants a given action — `exactTenantHolders`. */
export interface ActionHolder {
  userId: string;
  roleId: string;
}

export interface AssignRoleInput {
  userId: string;
  tenantId: string | null;
  roleId: string;
  /** Always the acting user — the `.api` service sets it, never the client. */
  grantedBy: string;
  /** When the role stops applying; `null`/omitted = no expiry. Re-assigning replaces it. */
  expiresAt?: Date | null;
}

export interface RevokeRoleInput {
  userId: string;
  tenantId: string | null;
  roleId: string;
}
