/**
 * Injection tokens for the permission-table (Model 2) family. Symbols, not
 * string literals — a typo in a binding is a compile error, not a silently
 * unbound provider.
 *
 * A stack adapter (`.postgres-drizzle`, …) binds `PERMISSION_REPOSITORY` and
 * `DELEGATION_REPOSITORY` to its own implementations, then spreads
 * `permissionTableProviders()` to get the stack-agnostic resolver, authorizer
 * and delegation service on top.
 */

/** A stack adapter's `PermissionRepository` implementation — the role/delegation reads `PermissionResolver` needs. */
export const PERMISSION_REPOSITORY = Symbol('PERMISSION_REPOSITORY');

/** A stack adapter's `DelegationRepository` implementation — the delegation-row writes/reads `DelegationService` needs. */
export const DELEGATION_REPOSITORY = Symbol('DELEGATION_REPOSITORY');

/** `DelegationOptions` — `{ maxDelegationDays }`. Bound by `permissionTableProviders()`. */
export const AUTHZ_DELEGATION_OPTIONS = Symbol('AUTHZ_DELEGATION_OPTIONS');

/**
 * The `Authorizer` implementation this family provides (with the optional
 * `allowedActions`). Pass it to
 * `AuthorizationModule.forRoot({ authorizerToken: PERMISSION_TABLE_AUTHORIZER })`.
 */
export const PERMISSION_TABLE_AUTHORIZER = Symbol('PERMISSION_TABLE_AUTHORIZER');

/** `DelegationService` — `delegate()` / `revokeDelegation()` / `listDelegations()`. */
export const AUTHZ_DELEGATION_SERVICE = Symbol('AUTHZ_DELEGATION_SERVICE');

/** A stack adapter's `AuthzAdminPort` implementation — `assignRole` / `revokeRole` / `setActionDescription`. */
export const AUTHZ_ADMIN_PORT = Symbol('AUTHZ_ADMIN_PORT');

/** A stack adapter's `AuthzObservabilityPort` implementation — the role/assignment/delegation/explain reads for an admin screen. */
export const AUTHZ_OBSERVABILITY_PORT = Symbol('AUTHZ_OBSERVABILITY_PORT');

/** `AccessDenialObservabilityPort` — the denied-requests log's reads. Optional for `authorization.api`. */
export const ACCESS_DENIAL_OBSERVABILITY_PORT = Symbol('ACCESS_DENIAL_OBSERVABILITY_PORT');
