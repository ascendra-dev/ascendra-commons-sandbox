/**
 * What `PermissionResolver` needs from persistence — the SQL-free contract a
 * stack adapter implements. Bound under `PERMISSION_REPOSITORY`.
 */
export interface RolePermissionSet {
  /** Distinct actions granted by the user's assigned roles (this tenant, or global). */
  actions: string[];
  /** True when any assigned role grants every action. */
  grantsAll: boolean;
}

export interface PermissionRepository {
  /**
   * Actions granted by the actor's assigned roles matching `tenantId` (or with a
   * NULL / global scope). Excludes delegations.
   */
  loadRolePermissions(userId: string, tenantId: string | null): Promise<RolePermissionSet>;

  /**
   * Distinct actions currently delegated to `granteeId` within `tenantId` that
   * are still active (not revoked, not expired). Never called for a null-tenant
   * actor — delegation is always within a tenant.
   */
  loadActiveDelegatedActions(granteeId: string, tenantId: string): Promise<string[]>;
}
