import { sql } from 'drizzle-orm';
import type { AccessDenialRecorder } from '../ascendra-commons/authorization/authorization.core';
import { DEMO_DESCRIPTIONS } from '../demo/demo-access';
import type { Database } from '../db/database.module';
import type { Rng } from './rng';

/**
 * Generates authorization's people and access history — what the access console shows. Through the module's own
 * entry points wherever one exists:
 *
 * - **People** — rows in the sandbox's own users table (`demo_user`, the directory), a few dozen per tenant.
 * - **Roles** — assigned over HTTP by each tenant's admin (`POST /authz/users/:id/roles`, a cohort through the bulk
 *   route), so every one is audited and passes the role ceiling. The API stamps `granted_at` now; the past can't be
 *   assigned, so each is then moved back to a plausible day (the stand-in step job-history takes for runs).
 * - **Delegations** — lent over HTTP by users holding the action: covering a leave, a refund backlog, one revoked, one
 *   left to lapse (its granter's role taken away after), one moved into the past so it reads expired.
 * - **The catalog** — descriptions set over HTTP (`PATCH /authz/actions/:name`), two left blank; one row for an action
 *   the code no longer has (`invoice.rescind` — catalog drift).
 * - **Denied requests** — 30 days of them through the real recorder, each at its own past moment (a 403 can't be
 *   asked for in the past), plus a few real ones over HTTP now.
 */

const TENANTS: Array<{ id: string; domain: string; people: number }> = [
  { id: 'tenant_acme', domain: 'acme.test', people: 24 },
  { id: 'tenant_globex', domain: 'globex.test', people: 14 },
  { id: 'tenant_meridian', domain: 'meridian.test', people: 8 },
];

const FIRST = ['Amara', 'Bilal', 'Chen', 'Dana', 'Elif', 'Farah', 'Gabriel', 'Hana', 'Ivan', 'Jia', 'Kofi', 'Lena', 'Mateo', 'Nadia', 'Omar', 'Priya', 'Quinn', 'Rania', 'Sami', 'Tara', 'Usman', 'Vera', 'Wen', 'Yusuf', 'Zara'];
const LAST = ['Ahmed', 'Brooks', 'Castillo', 'Diallo', 'Evans', 'Fischer', 'Garcia', 'Haddad', 'Ito', 'Jensen', 'Khan', 'Lopez', 'Mensah', 'Novak', 'Okafor', 'Park', 'Rossi', 'Silva', 'Tanaka', 'Weber'];

/** Platform staff without a tenant — one more support engineer, and a security reviewer with no role yet. */
const STAFF = [
  { id: 'ops@ascendra.test', name: 'Ola Ops', role: 'platform-support' },
  { id: 'security@ascendra.test', name: 'Sec Review', role: null },
];

const DAY = 24 * 60 * 60 * 1000;

export interface AccessTotals {
  people: number;
  assignments: number;
  delegations: number;
  denials: number;
}

interface Person {
  id: string;
  name: string;
  tenantId: string;
  roles: string[];
}

export class AccessHistory {
  private readonly tokens = new Map<string, string>();
  private readonly totals: AccessTotals = { people: 0, assignments: 0, delegations: 0, denials: 0 };

  constructor(
    private readonly baseUrl: string,
    private readonly db: Database,
    private readonly denials: AccessDenialRecorder,
    private readonly rng: Rng,
  ) {}

  async run(until: Date): Promise<AccessTotals> {
    const byTenant = await this.people();
    await this.describeCatalog();
    for (const [tenantId, people] of byTenant) await this.assignRoles(tenantId, people);
    await this.staffRoles();
    await this.backdateAssignments(until);
    for (const [tenantId, people] of byTenant) await this.delegations(tenantId, people);
    await this.pastDenials(byTenant, until);
    await this.denialsNow(byTenant);
    await this.expireOneContractor();
    return this.totals;
  }

  /** People — the app's own users table, which the directory reads. */
  private async people(): Promise<Map<string, Person[]>> {
    const byTenant = new Map<string, Person[]>();
    const used = new Set<string>();
    for (const tenant of TENANTS) {
      const people: Person[] = [];
      while (people.length < tenant.people) {
        const first = this.rng.pick(FIRST);
        const last = this.rng.pick(LAST);
        const id = `${first}.${last}@${tenant.domain}`.toLowerCase();
        if (used.has(id)) continue;
        used.add(id);
        people.push({ id, name: `${first} ${last}`, tenantId: tenant.id, roles: [] });
      }
      byTenant.set(tenant.id, people);
      for (const p of people) {
        await this.db.execute(sql`
          insert into demo_user (id, name, email, tenant_id) values (${p.id}, ${p.name}, ${p.id}, ${p.tenantId})
          on conflict (id) do nothing
        `);
      }
      this.totals.people += people.length;
    }
    for (const s of STAFF) {
      await this.db.execute(sql`
        insert into demo_user (id, name, email, tenant_id) values (${s.id}, ${s.name}, ${s.id}, null)
        on conflict (id) do nothing
      `);
      this.totals.people += 1;
    }
    return byTenant;
  }

  private async describeCatalog(): Promise<void> {
    const admin = await this.token('platform.admin@ascendra.test');
    for (const [action, description] of Object.entries(DEMO_DESCRIPTIONS)) {
      await this.call(admin, 'PATCH', `/authz/actions/${encodeURIComponent(action)}`, { description }, 204);
    }
    // An action the code dropped (renamed to invoice.void) — still a catalog row: drift on the catalog screen.
    await this.db.execute(sql`
      insert into commons_authz_action (name, description, scope)
      values ('invoice.rescind', 'Rescind an issued invoice (renamed: invoice.void)', 'tenant')
      on conflict (name) do nothing
    `);
  }

  /**
   * Roles by each tenant's admin: most people get one product role, some two; a second admin in the bigger tenants;
   * a few contractors with an expiry; a handful onboarding with none. Globex's viewers arrive as one bulk assignment.
   */
  private async assignRoles(tenantId: string, people: Person[]): Promise<void> {
    const admin = await this.token(`admin@${people[0].id.split('@')[1]}`);
    const [second, ...rest] = people;
    if (people.length > 10) {
      await this.assign(admin, second, 'tenant-admin');
    }
    const cohort: Person[] = [];
    for (const [i, person] of rest.entries()) {
      if (i % 9 === 4) continue; // onboarding — no role yet
      if (tenantId === 'tenant_globex' && i % 3 === 0) {
        cohort.push(person);
        continue;
      }
      const role = this.rng.pick(['billing-clerk', 'billing-clerk', 'support-agent', 'viewer', 'finance-approver', 'auditor']);
      // Contractors: an expiry 3 days out (expiring soon) or 25 days out.
      const expiresAt = i % 7 === 2 ? new Date(Date.now() + (this.rng.chance(0.5) ? 3 : 25) * DAY) : undefined;
      await this.assign(admin, person, role, expiresAt);
      if (this.rng.chance(0.2)) await this.assign(admin, person, role === 'viewer' ? 'auditor' : 'viewer');
    }
    if (cohort.length > 0) {
      await this.call(admin, 'POST', '/authz/roles/viewer/holders', { userIds: cohort.map((p) => p.id) }, 201);
      for (const p of cohort) p.roles.push('viewer');
      this.totals.assignments += cohort.length;
    }
  }

  private async staffRoles(): Promise<void> {
    const admin = await this.token('platform.admin@ascendra.test');
    for (const s of STAFF) {
      if (s.role) await this.call(admin, 'POST', `/authz/users/${encodeURIComponent(s.id)}/roles`, { roleId: s.role, tenantId: null }, 204);
    }
  }

  /**
   * The API stamps `granted_at` now — the past can't be assigned. Each assignment but the dev users' moves back to a
   * plausible day in the last 120, so the ledger reads like history.
   */
  private async backdateAssignments(until: Date): Promise<void> {
    const { rows } = await this.db.execute(sql`
      select user_id, tenant_id, role_id from commons_authz_user_role where granted_by <> 'system'
    `);
    for (const r of rows as Array<{ user_id: string; tenant_id: string | null; role_id: string }>) {
      const at = new Date(until.getTime() - this.rng.int(1, 120) * DAY - this.rng.int(0, DAY - 1));
      await this.db.execute(sql`
        update commons_authz_user_role set granted_at = ${at}
        where user_id = ${r.user_id} and role_id = ${r.role_id} and tenant_id is not distinct from ${r.tenant_id}
      `);
    }
  }

  /** One contractor's role, expired four days ago (an expiry can't be set in the past over the API). Last, so no one lends after it. */
  private async expireOneContractor(): Promise<void> {
    await this.db.execute(sql`
      update commons_authz_user_role set expires_at = now() - interval '4 days'
      where ctid = (select ctid from commons_authz_user_role where expires_at > now() + interval '10 days' limit 1)
    `);
  }

  /** Lent over HTTP by someone holding the action — each case the ledger and the Overview should show. */
  private async delegations(tenantId: string, people: Person[]): Promise<void> {
    const holding = (role: string) => people.filter((p) => p.roles.includes(role));
    const approver = holding('finance-approver')[0];
    const agent = holding('support-agent')[0];
    const clerks = holding('billing-clerk');
    const viewers = holding('viewer');

    // Cover during a leave: payout approval for 10 days.
    if (approver && clerks[0]) await this.delegate(approver, clerks[0], ['payout.approve', 'invoice.void'], 10, 'Cover during annual leave');
    // A refund backlog: two days — expiring soon.
    if (agent && clerks[1]) await this.delegate(agent, clerks[1], ['payment.refund'], 2, 'Refund backlog this week');
    // One revoked by its granter.
    if (agent && viewers[0]) {
      const d = await this.delegate(agent, viewers[0], ['customer.edit'], 14, 'Data clean-up');
      if (d) await this.call(await this.token(agent.id), 'DELETE', `/authz/delegations/${d}`, undefined, 204);
    }
    // One that lapses: its granter loses the role afterwards (Acme only — it has the second admin to do it).
    if (tenantId === 'tenant_acme') {
      // A second finance approver for the lapse, if the draw gave none.
      if (!people.some((p) => p !== approver && p.roles.length === 1 && p.roles[0] === 'finance-approver')) {
        const spare = people.find((p) => p !== approver && p.roles.length === 0);
        if (spare) await this.assign(await this.token('admin@acme.test'), spare, 'finance-approver');
      }
      // A lender whose only role grants it — so losing that role really takes the action away.
      const lender = people.find((p) => p !== approver && p.roles.length === 1 && p.roles[0] === 'finance-approver');
      const borrower = viewers[1] ?? clerks[2];
      if (lender && borrower) {
        const lent = lender.roles[0];
        await this.delegate(lender, borrower, ['report.export'], 20, 'Month-end reports');
        await this.call(await this.token('admin@acme.test'), 'DELETE', `/authz/users/${encodeURIComponent(lender.id)}/roles/${lent}`, undefined, 204);
        lender.roles = lender.roles.filter((r) => r !== lent);
      }
    }
    // One in the past: created and expired weeks ago (an expiry can't be set in the past over the API).
    if (clerks[0] && viewers[2]) {
      const d = await this.delegate(clerks[0], viewers[2], ['invoice.send'], 5, 'Quarter close');
      if (d) {
        await this.db.execute(sql`
          update commons_authz_delegation
          set created_at = now() - interval '40 days', expires_at = now() - interval '33 days'
          where id = ${d}::uuid
        `);
      }
    }
  }

  /**
   * 30 days of 403s through the real recorder, each at its own moment: members opening the audit log and the access
   * console they don't hold, a tenant admin poking at platform pages, and one Meridian user probing role assignment.
   */
  private async pastDenials(byTenant: Map<string, Person[]>, until: Date): Promise<void> {
    const routes: Array<{ action: string; method: string; route: string }> = [
      { action: 'audit.view', method: 'GET', route: '/audit/events' },
      { action: 'authz.view', method: 'GET', route: '/authz/users' },
      { action: 'job.view', method: 'GET', route: '/jobs' },
      { action: 'rate-limit.view', method: 'GET', route: '/rate-limits/rejections' },
    ];
    for (let day = 30; day >= 1; day--) {
      for (const [tenantId, people] of byTenant) {
        const tries = this.rng.int(0, tenantId === 'tenant_acme' ? 6 : 3);
        for (let i = 0; i < tries; i++) {
          const person = this.rng.pick(people);
          const target = this.rng.pick(routes);
          this.deny(person.id, tenantId, target, new Date(until.getTime() - day * DAY + this.rng.int(8, 18) * 60 * 60 * 1000));
        }
      }
      // A tenant admin wandering into platform pages now and then.
      if (day % 6 === 0) {
        this.deny('admin@globex.test', 'tenant_globex', { action: 'job.run', method: 'POST', route: '/jobs/:name/run' }, new Date(until.getTime() - day * DAY));
      }
    }
    // A Meridian user probing role assignment — 40 tries in two minutes, five days ago.
    const prober = byTenant.get('tenant_meridian')![3];
    const at = until.getTime() - 5 * DAY;
    for (let i = 0; i < 40; i++) {
      this.deny(prober.id, 'tenant_meridian', { action: 'authz.assign_roles', method: 'POST', route: '/authz/users/:userId/roles' }, new Date(at + i * 3_000));
    }
  }

  /** A few real ones over HTTP — the guard records them itself. */
  private async denialsNow(byTenant: Map<string, Person[]>): Promise<void> {
    const member = await this.token('member@acme.test');
    await this.call(member, 'GET', '/jobs', undefined, 403);
    await this.call(member, 'GET', '/authz/users', undefined, 403);
    const someone = await this.token(byTenant.get('tenant_globex')![5].id);
    await this.call(someone, 'GET', '/audit/events', undefined, 403);
    this.totals.denials += 3;
  }

  private deny(actorId: string, tenantId: string | null, target: { action: string; method: string; route: string }, at: Date) {
    this.denials.recordDenial({ actorId, tenantId, ...target, at });
    this.totals.denials += 1;
  }

  private async assign(adminToken: string, person: Person, roleId: string, expiresAt?: Date): Promise<void> {
    await this.call(adminToken, 'POST', `/authz/users/${encodeURIComponent(person.id)}/roles`, { roleId, expiresAt: expiresAt?.toISOString() }, 204);
    person.roles.push(roleId);
    this.totals.assignments += 1;
  }

  private async delegate(granter: Person, grantee: Person, actions: string[], days: number, reason: string): Promise<string | null> {
    if (granter.id === grantee.id) return null;
    const res = await this.call(await this.token(granter.id), 'POST', '/authz/delegations', {
      granteeId: grantee.id,
      actions,
      expiresAt: new Date(Date.now() + days * DAY).toISOString(),
      reason,
    }, 201);
    this.totals.delegations += 1;
    return (res as { id: string }).id;
  }

  private async token(actorId: string): Promise<string> {
    const cached = this.tokens.get(actorId);
    if (cached) return cached;
    const res = await fetch(`${this.baseUrl}/dev/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorId }),
    });
    if (!res.ok) throw new Error(`POST /dev/token for ${actorId} answered ${res.status}`);
    const { token } = (await res.json()) as { token: string };
    this.tokens.set(actorId, token);
    return token;
  }

  private async call(token: string, method: string, path: string, body: unknown, expected: number): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status !== expected) throw new Error(`${method} ${path} answered ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }
}
