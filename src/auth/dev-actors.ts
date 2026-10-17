import type { Actor } from '../ascendra-commons/authorization/authorization.core';
import { AUDIT_ACTIONS } from '../ascendra-commons/audit-logging/audit-logging.api';

/** Every action this app knows — `GET /me` reports which of these the actor holds. */
export const ALL_ACTIONS: string[] = [...Object.values(AUDIT_ACTIONS)];

/** Persona → actions, for the static-map authorizer (Model 1). An unlisted persona is denied everything. */
export const PERSONA_ACTIONS: Record<string, string[]> = {
  'platform-admin': [AUDIT_ACTIONS.VIEW],
  'tenant-admin': [AUDIT_ACTIONS.VIEW],
  member: [],
};

export interface DevActor extends Actor {
  label: string;
}

/**
 * The people you can sign in as (`POST /dev/token`). Ids look like emails because the audit log records the actor id
 * and the UI shows it. A platform admin has no tenant, so it reads every tenant's records; a tenant admin reads only
 * its own; a member has no `audit.view`, so the audit API answers 403.
 */
export const DEV_ACTORS: DevActor[] = [
  { id: 'platform.admin@ascendra.test', persona: 'platform-admin', tenantId: null, label: 'Platform admin' },
  { id: 'admin@acme.test', persona: 'tenant-admin', tenantId: 'tenant_acme', label: 'Acme — tenant admin' },
  { id: 'admin@globex.test', persona: 'tenant-admin', tenantId: 'tenant_globex', label: 'Globex — tenant admin' },
  { id: 'admin@meridian.test', persona: 'tenant-admin', tenantId: 'tenant_meridian', label: 'Meridian — tenant admin' },
  { id: 'member@acme.test', persona: 'member', tenantId: 'tenant_acme', label: 'Acme — member (no audit access)' },
];
