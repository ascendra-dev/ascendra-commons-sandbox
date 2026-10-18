import type { Actor } from '../ascendra-commons/authorization/authorization.core';

export interface DevActor extends Actor {
  label: string;
}

/**
 * The people you can sign in as (`POST /dev/token`). Ids look like emails because the audit log records the actor id
 * and the UI shows it. A platform admin has no tenant, so it reads every tenant's records; a tenant admin reads only
 * its own; a member has no `audit.view`, so the audit API answers 403. What each persona may do is authorization's
 * config — PERSONA_ACTIONS in src/modules/commons/authorization.ts.
 */
export const DEV_ACTORS: DevActor[] = [
  { id: 'platform.admin@ascendra.test', persona: 'platform-admin', tenantId: null, label: 'Platform admin' },
  { id: 'admin@acme.test', persona: 'tenant-admin', tenantId: 'tenant_acme', label: 'Acme — tenant admin' },
  { id: 'admin@globex.test', persona: 'tenant-admin', tenantId: 'tenant_globex', label: 'Globex — tenant admin' },
  { id: 'admin@meridian.test', persona: 'tenant-admin', tenantId: 'tenant_meridian', label: 'Meridian — tenant admin' },
  { id: 'member@acme.test', persona: 'member', tenantId: 'tenant_acme', label: 'Acme — member (no audit access)' },
];
