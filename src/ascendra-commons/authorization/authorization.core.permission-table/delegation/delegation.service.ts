import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../authorization.core';
import { PermissionResolver } from '../resolution/permission-resolver';
import type { DelegationRepository } from '../ports/delegation-repository.port';
import type { CreateDelegationInput, DelegationOptions, DelegationRecord } from '../types/delegation.types';
import { AUTHZ_DELEGATION_OPTIONS, DELEGATION_REPOSITORY } from '../tokens';
import { CannotDelegateError } from './delegation.errors';
import { assertDelegationExpiry, undelegatableActions } from './delegation.rules';

/**
 * Minimal delegation (v1): a user grants a subset of their own role-derived
 * actions to another user, within one tenant, time-boxed and revocable.
 *
 * **Snapshot model** — `actions` is fixed at grant time. If the granter later
 * loses one of those actions, the delegation keeps carrying it until it expires
 * or is revoked; the mandatory capped `expiresAt` plus one-call revoke are what
 * bound that.
 *
 * **Chains are blocked by construction** — the grant-time check reads the
 * granter's **role** permissions only (`PermissionResolver.rolePermissions`),
 * never their delegated-in ones, so a delegated action can't itself be
 * re-delegated.
 *
 * Stack-agnostic: rules here, persistence behind `DelegationRepository`. Audit
 * is the consumer's to wire — `authorization.api` emits an `AuditRecordRaised`
 * around these calls; this service takes no dependency on audit-logging.
 */
@Injectable()
export class DelegationService {
  constructor(
    @Inject(DELEGATION_REPOSITORY) private readonly repo: DelegationRepository,
    @Inject(AUTHZ_DELEGATION_OPTIONS) private readonly options: DelegationOptions,
    @Inject(PermissionResolver) private readonly resolver: PermissionResolver,
  ) {}

  async delegate(input: CreateDelegationInput): Promise<DelegationRecord> {
    if (input.actions.length === 0) {
      throw new CannotDelegateError([]);
    }
    assertDelegationExpiry(input.expiresAt, this.options.maxDelegationDays);

    const granter: Actor = { id: input.granterId, persona: '', tenantId: input.tenantId };
    const rolePerms = await this.resolver.rolePermissions(granter);
    const missing = undelegatableActions(input.actions, rolePerms);
    if (missing.length > 0) throw new CannotDelegateError(missing);

    return this.repo.insert(input);
  }

  /** Sets `revoked_at` if the delegation is still active. Idempotent. */
  revokeDelegation(id: string, revokedBy: string): Promise<void> {
    return this.repo.revoke(id, revokedBy);
  }

  /** One delegation by id, or `null` if it doesn't exist. `authorization.api` uses this for the tenant-ceiling check before a revoke. */
  getById(id: string): Promise<DelegationRecord | null> {
    return this.repo.getById(id);
  }

  /** Delegations this actor granted and delegations granted to them, in this tenant, newest first. */
  async listDelegations(actor: Actor): Promise<{ granted: DelegationRecord[]; received: DelegationRecord[] }> {
    const records = await this.repo.listForActor(actor.id, actor.tenantId);
    return {
      granted: records.filter((r) => r.granterId === actor.id),
      received: records.filter((r) => r.granteeId === actor.id),
    };
  }
}
