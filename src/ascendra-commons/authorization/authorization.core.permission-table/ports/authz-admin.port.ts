import type { AssignRoleInput, RevokeRoleInput } from '../types/authz-admin.types';

/**
 * The narrow set of authorization mutations an admin screen needs. Bound under
 * `AUTHZ_ADMIN_PORT` by a stack adapter; consumed by `authorization.api`.
 *
 * Role→permission editing is deliberately **not** here — that's platform-admin
 * territory, changed by migration/seed, typically `REVOKE`d from the app DB role
 * (see the adapter README). Delegation create/revoke lives in `DelegationService`.
 *
 * Implementations raise `RoleNotFoundError` / `ActionNotFoundError` from
 * `authz-admin.errors.ts`.
 */
export interface AuthzAdminPort {
  /** Assigning a role the user already holds (same tenant) renews it: `grantedBy`, `grantedAt` and `expiresAt` are replaced. */
  assignRole(input: AssignRoleInput): Promise<void>;
  /** `false` when the user didn't hold the role there — nothing changed. */
  revokeRole(input: RevokeRoleInput): Promise<boolean>;
  /** Fill in (or clear) the free-text description of a catalog action. */
  setActionDescription(action: string, description: string | null): Promise<void>;
}
