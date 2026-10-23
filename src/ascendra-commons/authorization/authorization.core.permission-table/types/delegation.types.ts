export interface DelegationOptions {
  /** Hard cap on how far out `expiresAt` may be set. No indefinite delegations. */
  maxDelegationDays: number;
}

export interface CreateDelegationInput {
  granterId: string;
  granteeId: string;
  tenantId: string;
  actions: string[];
  expiresAt: Date;
  reason?: string;
  /** Who initiated it — normally the granter; an admin id if admin-initiated. Defaults to `granterId`. */
  createdBy?: string;
}

export interface DelegationRecord {
  id: string;
  granterId: string;
  granteeId: string;
  tenantId: string;
  actions: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  reason: string | null;
  createdAt: Date;
  status: DelegationStatus;
}

export type DelegationStatus = 'active' | 'expired' | 'revoked';
