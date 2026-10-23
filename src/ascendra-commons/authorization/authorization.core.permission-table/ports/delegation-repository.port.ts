import type { CreateDelegationInput, DelegationRecord } from '../types/delegation.types';

/**
 * The delegation-row persistence a stack adapter implements. Bound under
 * `DELEGATION_REPOSITORY`. All grant-time validation (expiry cap, "granter holds
 * these actions", chain-blocking) happens in `DelegationService` before `insert`
 * is called — the repository is a straight write/read.
 */
export interface DelegationRepository {
  /** Persist a new delegation row and return it. `reason`/`createdBy` defaults are the repository's to apply. */
  insert(input: CreateDelegationInput): Promise<DelegationRecord>;

  /** Set `revoked_at`/`revoked_by` if the row is still active. Idempotent. */
  revoke(id: string, revokedBy: string): Promise<void>;

  /** One delegation by id, or `null` if it doesn't exist. Used to enforce the tenant ceiling before a revoke. */
  getById(id: string): Promise<DelegationRecord | null>;

  /** Every delegation this actor granted or received, within `tenantId`, newest first. */
  listForActor(actorId: string, tenantId: string | null): Promise<DelegationRecord[]>;
}
