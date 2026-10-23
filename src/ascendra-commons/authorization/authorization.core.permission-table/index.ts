// Ports — what a stack adapter implements
export type { PermissionRepository, RolePermissionSet } from './ports/permission-repository.port';
export type { DelegationRepository } from './ports/delegation-repository.port';
export type { AuthzAdminPort } from './ports/authz-admin.port';
export type { AuthzObservabilityPort } from './ports/authz-observability.port';
export type {
  AccessDenialObservabilityPort,
  AccessDenialView,
  AccessDenialQuery,
  AccessDenialPage,
  AccessDenialSummary,
} from './ports/access-denial-observability.port';

// Answer-shapes — what the ports return, what authorization.api serves
export type {
  ActionScope,
  AccessStats,
  ActionView,
  ActionHolder,
  RoleView,
  RoleDetail,
  UserRoleAssignment,
  AssignmentStatus,
  AssignmentQuery,
  AssignmentPage,
  DelegationView,
  DelegationQuery,
  DelegationPage,
  AccessExplanation,
  ActionCatalogHealth,
  AssignRoleInput,
  RevokeRoleInput,
  WhoCanRoleGrant,
  WhoCanDelegationGrant,
  WhoCanResult,
} from './types/authz-admin.types';
export type {
  DelegationOptions,
  CreateDelegationInput,
  DelegationRecord,
  DelegationStatus,
} from './types/delegation.types';
export type { ResolvedPermissions } from './types/resolved-permissions';
export { RoleNotFoundError, ActionNotFoundError, InvalidAuthzCursorError } from './admin/authz-admin.errors';

// Stack-agnostic implementation
export { PermissionResolver } from './resolution/permission-resolver';
export { PermissionTableAuthorizer } from './permission-table.authorizer';
export { DelegationService } from './delegation/delegation.service';
export { CannotDelegateError, InvalidDelegationExpiryError } from './delegation/delegation.errors';
export {
  deriveDelegationStatus,
  assertDelegationExpiry,
  undelegatableActions,
} from './delegation/delegation.rules';
export {
  AuthorizationCacheMiddleware,
  runWithPermissionCache,
  memoizePermissionLookup,
} from './cache/permission-cache';

// Wiring
export { permissionTableProviders } from './permission-table.providers';
export type { PermissionTableProvidersOptions } from './permission-table.providers';
export {
  PERMISSION_REPOSITORY,
  DELEGATION_REPOSITORY,
  AUTHZ_DELEGATION_OPTIONS,
  PERMISSION_TABLE_AUTHORIZER,
  AUTHZ_DELEGATION_SERVICE,
  AUTHZ_ADMIN_PORT,
  AUTHZ_OBSERVABILITY_PORT,
  ACCESS_DENIAL_OBSERVABILITY_PORT,
} from './tokens';
