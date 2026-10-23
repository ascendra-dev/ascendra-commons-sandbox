import type { ResolvedPermissions } from '../types/resolved-permissions';
import type { DelegationStatus } from '../types/delegation.types';
import { InvalidDelegationExpiryError } from './delegation.errors';

/**
 * The stack-agnostic delegation business rules — pure functions, no I/O. Shared
 * by `DelegationService` (grant-time checks) and every stack adapter's row→view
 * mapping (`deriveDelegationStatus`).
 */

/** `revoked` if revoked, else `expired` once `expiresAt` has passed, else `active`. */
export function deriveDelegationStatus(expiresAt: Date, revokedAt: Date | null): DelegationStatus {
  if (revokedAt) return 'revoked';
  return expiresAt.getTime() <= Date.now() ? 'expired' : 'active';
}

/** Throws `InvalidDelegationExpiryError` unless `expiresAt` is a valid future date within `maxDelegationDays`. */
export function assertDelegationExpiry(expiresAt: Date, maxDelegationDays: number): void {
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw new InvalidDelegationExpiryError('expiresAt is required and must be a valid Date');
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new InvalidDelegationExpiryError('expiresAt must be in the future');
  }
  const maxMs = maxDelegationDays * 24 * 60 * 60 * 1000;
  if (expiresAt.getTime() > Date.now() + maxMs) {
    throw new InvalidDelegationExpiryError(`expiresAt is beyond the ${maxDelegationDays}-day maximum`);
  }
}

/**
 * The requested actions the granter does **not** hold from their roles — empty
 * when the grant is allowed. Reads role permissions only (never delegated-in
 * ones), which is what blocks delegation chains.
 */
export function undelegatableActions(requested: readonly string[], rolePermissions: ResolvedPermissions): string[] {
  if (rolePermissions.grantsAll) return [];
  return requested.filter((a) => !rolePermissions.actions.has(a));
}
