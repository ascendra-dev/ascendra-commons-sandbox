import { Injectable } from '@nestjs/common';

/**
 * Where `authorization.api` sends an audit record after each mutation. Optional:
 * bind `AUTHZ_AUDIT_EMITTER` (e.g. to an adapter over `audit-logging`) and every
 * assignment / delegation / catalog edit is recorded; leave it unbound and the
 * no-op is used. `authorization.api` takes **no** dependency on `audit-logging` —
 * same posture as `DelegationService` (see `MODULE-STANDARD.md`, cross-module
 * deps target `.core` only).
 */
export interface AuthzAuditEvent {
  /** e.g. `'authz.role_assigned'`, `'authz.role_revoked'`, `'authz.delegation_granted'`. */
  action: string;
  actorId: string;
  tenantId: string | null;
  /** `'user_role'` | `'delegation'` | `'action_catalog'`. */
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export interface AuthzAuditEmitter {
  record(event: AuthzAuditEvent): Promise<void> | void;
}

/** The default binding — audit is opt-in. */
@Injectable()
export class NoopAuthzAuditEmitter implements AuthzAuditEmitter {
  record(): void {
    /* no-op */
  }
}
