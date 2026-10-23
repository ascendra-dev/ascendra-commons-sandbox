import type {
  AccessExplanation,
  AccessStats,
  ActionCatalogHealth,
  ActionHolder,
  ActionView,
  AssignmentPage,
  AssignmentQuery,
  DelegationPage,
  DelegationQuery,
  DelegationView,
  RoleView,
  WhoCanResult,
} from '../types/authz-admin.types';

/**
 * Read-only reporting over the permission-table model for an admin screen — the
 * role catalog, who holds what, "why can/can't user X do action Y", the
 * delegation ledger, and action-catalog drift. Bound under
 * `AUTHZ_OBSERVABILITY_PORT` by a stack adapter; consumed by `authorization.api`.
 * Never mutates — writes are `AuthzAdminPort` / `DelegationService`.
 *
 * Every read resolves the way `PermissionTableAuthorizer` does: an expired role assignment grants nothing, and a
 * delegation grants only what its granter still holds from a role.
 */
export interface AuthzObservabilityPort {
  /** Every role with its granted actions and scope. */
  listRoles(): Promise<RoleView[]>;
  /** One role by id, or `null` if it doesn't exist. */
  getRole(id: string): Promise<RoleView | null>;
  /** Distinct users actively holding this role — in `tenantId` only when given (`null` = global assignments only). */
  countHolders(roleId: string, tenantId?: string | null): Promise<number>;
  /** The action catalog: each action's description, scope and the roles granting it. */
  listActions(): Promise<ActionView[]>;
  /** Role assignments, filtered, newest first, keyset-paginated. */
  listUserRoleAssignments(query?: AssignmentQuery): Promise<AssignmentPage>;
  /** "Can this user do `action` (if given), and why." */
  explainAccess(userId: string, tenantId: string | null, action?: string): Promise<AccessExplanation>;
  /** The delegation ledger, filtered, newest first, keyset-paginated. */
  listDelegations(query?: DelegationQuery): Promise<DelegationPage>;
  /** One delegation by id, or `null`. */
  getDelegation(id: string): Promise<DelegationView | null>;
  /** Drift between the app's `Actions` catalog and the action-catalog table. */
  actionCatalogHealth(knownActions: readonly string[]): Promise<ActionCatalogHealth>;
  /** The reverse of `explainAccess` — every role and active delegation that grants `action`, plus holders, scoped to `tenantId` when given. */
  whoCan(action: string, tenantId?: string): Promise<WhoCanResult>;
  /**
   * Active assignments in exactly `tenantId` (`null` = global ones) of a role granting `action` — directly or by
   * granting all. What the lockout rule counts: who else could still administer this tenant.
   */
  exactTenantHolders(action: string, tenantId: string | null): Promise<ActionHolder[]>;
  /** Access posture — for one tenant when given, else every tenant. */
  accessStats(tenantId?: string): Promise<AccessStats>;
}
