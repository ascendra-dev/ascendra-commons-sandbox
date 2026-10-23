import type { Provider } from '@nestjs/common';
import { PermissionResolver } from './resolution/permission-resolver';
import { PermissionTableAuthorizer } from './permission-table.authorizer';
import { DelegationService } from './delegation/delegation.service';
import { AUTHZ_DELEGATION_OPTIONS, AUTHZ_DELEGATION_SERVICE, PERMISSION_TABLE_AUTHORIZER } from './tokens';

export interface PermissionTableProvidersOptions {
  /**
   * Hard cap on delegation lifetime, in days. Default 90. There are no
   * indefinite delegations — every `delegate()` must set `expiresAt` within this
   * window.
   */
  maxDelegationDays?: number;
}

/**
 * The stack-agnostic half of a Model 2 wiring: the resolver, the `Authorizer`,
 * and the delegation service. A stack adapter binds `PERMISSION_REPOSITORY` and
 * `DELEGATION_REPOSITORY` to its own implementations, then spreads this into the
 * same module's `providers`:
 *
 * ```typescript
 * providers: [
 *   { provide: AUTHZ_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
 *   PostgresPermissionRepository,
 *   { provide: PERMISSION_REPOSITORY, useExisting: PostgresPermissionRepository },
 *   PostgresDelegationRepository,
 *   { provide: DELEGATION_REPOSITORY, useExisting: PostgresDelegationRepository },
 *   ...permissionTableProviders({ maxDelegationDays: config.maxDelegationDays }),
 * ]
 * ```
 *
 * Then export `PERMISSION_TABLE_AUTHORIZER` and `AUTHZ_DELEGATION_SERVICE`.
 */
export function permissionTableProviders(options: PermissionTableProvidersOptions = {}): Provider[] {
  return [
    { provide: AUTHZ_DELEGATION_OPTIONS, useValue: { maxDelegationDays: options.maxDelegationDays ?? 90 } },
    PermissionResolver,
    PermissionTableAuthorizer,
    { provide: PERMISSION_TABLE_AUTHORIZER, useExisting: PermissionTableAuthorizer },
    DelegationService,
    { provide: AUTHZ_DELEGATION_SERVICE, useExisting: DelegationService },
  ];
}
