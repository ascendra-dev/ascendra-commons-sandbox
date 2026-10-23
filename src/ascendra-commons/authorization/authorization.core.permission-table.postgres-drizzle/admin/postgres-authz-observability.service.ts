import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  InvalidAuthzCursorError,
  type AccessExplanation,
  type AccessStats,
  type ActionCatalogHealth,
  type ActionHolder,
  type ActionScope,
  type ActionView,
  type AssignmentPage,
  type AssignmentQuery,
  type AuthzObservabilityPort,
  type DelegationPage,
  type DelegationQuery,
  type DelegationView,
  type RoleView,
  type UserRoleAssignment,
  type WhoCanResult,
} from '../../authorization.core.permission-table';
import { activeAssignment, decodeCursor, encodeCursor, granterStillHolds, isoMicros, textArray } from '../persistence/sql-helpers';
import type { SqlExecutor } from '../persistence/sql-executor';
import { AUTHZ_SQL_EXECUTOR } from '../tokens';

const DEFAULT_DELEGATION_LIMIT = 50;
const MAX_DELEGATION_LIMIT = 200;
const DEFAULT_ASSIGNMENT_LIMIT = 100;
const MAX_ASSIGNMENT_LIMIT = 500;

/** A role with its actions and their scopes — one row per role. */
const ROLE_SELECT = sql`
  select r.id, r.description, r.grants_all,
         coalesce(array_agg(rp.action order by rp.action) filter (where rp.action is not null), '{}') as actions,
         coalesce(array_agg(rp.action order by rp.action) filter (where a.scope = 'platform'), '{}') as platform_actions
  from commons_authz_role r
  left join commons_authz_role_permission rp on rp.role_id = r.id
  left join commons_authz_action a on a.name = rp.action
`;

/** What a delegation (alias `d`) no longer grants — the actions its granter has stopped holding from a role. */
const LAPSED_ACTIONS = sql`array(
  select la.action from unnest(d.actions) as la(action)
  where not ${granterStillHolds('d', sql`la.action`)}
) as lapsed_actions`;

/**
 * `AuthzObservabilityPort` for Postgres/Drizzle — read-only reporting over
 * `commons_authz_*` for an admin screen. Never mutates; writes are
 * `PostgresAuthzAdminService` / `DelegationService`. No `application` column
 * exists on these tables (the role catalog is project-specific —
 * `MODULE-STANDARD.md` dimension 4).
 *
 * Every read resolves the way `PermissionTableAuthorizer` does — an expired assignment grants nothing
 * (`activeAssignment`), and a delegation grants only what its granter still holds (`granterStillHolds`) — so the
 * console never shows access the guard wouldn't honour.
 */
@Injectable()
export class PostgresAuthzObservabilityService implements AuthzObservabilityPort {
  constructor(@Inject(AUTHZ_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async listRoles(): Promise<RoleView[]> {
    const { rows } = await this.db.execute<RoleRow>(sql`
      ${ROLE_SELECT}
      group by r.id, r.description, r.grants_all
      order by r.id
    `);
    return rows.map(toRoleView);
  }

  async getRole(id: string): Promise<RoleView | null> {
    const { rows } = await this.db.execute<RoleRow>(sql`
      ${ROLE_SELECT}
      where r.id = ${id}
      group by r.id, r.description, r.grants_all
    `);
    return rows[0] ? toRoleView(rows[0]) : null;
  }

  async countHolders(roleId: string, tenantId?: string | null): Promise<number> {
    const tenantCond =
      tenantId === undefined ? sql`` : tenantId === null ? sql`and ur.tenant_id is null` : sql`and ur.tenant_id = ${tenantId}`;
    const { rows } = await this.db.execute<{ count: string | number }>(sql`
      select count(distinct ur.user_id) as count
      from commons_authz_user_role ur
      where ur.role_id = ${roleId} and ${activeAssignment('ur')} ${tenantCond}
    `);
    return Number(rows[0]?.count ?? 0);
  }

  async listActions(): Promise<ActionView[]> {
    const { rows } = await this.db.execute<{
      name: string;
      description: string | null;
      scope: string;
      role_ids: string[] | null;
    }>(sql`
      select a.name, a.description, a.scope,
             coalesce(array_agg(rp.role_id order by rp.role_id) filter (where rp.role_id is not null), '{}') as role_ids
      from commons_authz_action a
      left join commons_authz_role_permission rp on rp.action = a.name
      group by a.name, a.description, a.scope
      order by a.name
    `);
    return rows.map((r) => ({
      name: r.name,
      description: r.description,
      scope: r.scope === 'platform' ? 'platform' : 'tenant',
      roleIds: [...(r.role_ids ?? [])],
    }));
  }

  async listUserRoleAssignments(query: AssignmentQuery = {}): Promise<AssignmentPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_ASSIGNMENT_LIMIT), MAX_ASSIGNMENT_LIMIT);
    const conds: SQL[] = [];
    if (query.userId !== undefined) conds.push(sql`ur.user_id = ${query.userId}`);
    if (query.userIds !== undefined) conds.push(sql`ur.user_id = any(${textArray(query.userIds)})`);
    if ('tenantId' in query && query.tenantId !== undefined) {
      conds.push(query.tenantId === null ? sql`ur.tenant_id is null` : sql`ur.tenant_id = ${query.tenantId}`);
    }
    if (query.roleId !== undefined) conds.push(sql`ur.role_id = ${query.roleId}`);
    if (query.status === 'active') conds.push(activeAssignment('ur'));
    if (query.status === 'expired') conds.push(sql`ur.expires_at <= now()`);
    if (query.expiringWithinDays !== undefined) {
      conds.push(
        sql`ur.expires_at > now() and ur.expires_at <= now() + (${query.expiringWithinDays} * interval '1 day')`,
      );
    }
    if (query.cursor) {
      const c = decodeCursor(query.cursor, ['ts', 'userId', 'roleId', 'tenantId'], ['tenantId']);
      if (!c) throw new InvalidAuthzCursorError(query.cursor);
      const ts = sql`${c.ts}::timestamptz`;
      // (granted_at, user_id, role_id, tenant_id) descending — the last two make the order total.
      conds.push(sql`(ur.granted_at < ${ts} or (ur.granted_at = ${ts} and (ur.user_id, ur.role_id, coalesce(ur.tenant_id, ''))
        < (${c.userId}, ${c.roleId}, ${c.tenantId ?? ''})))`);
    }
    const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;

    const { rows } = await this.db.execute<AssignmentRow>(sql`
      select ur.user_id, ur.tenant_id, ur.role_id, ur.granted_at, ur.granted_by, ur.expires_at,
             ${isoMicros('ur.granted_at', 'granted_at_key')}
      from commons_authz_user_role ur
      ${where}
      order by ur.granted_at desc, ur.user_id desc, ur.role_id desc, coalesce(ur.tenant_id, '') desc
      limit ${limit + 1}
    `);
    const page = rows.slice(0, limit);
    const assignments = page.map(toAssignment);
    if (rows.length > limit) {
      const last = page[page.length - 1];
      return {
        assignments,
        nextCursor: encodeCursor({ ts: last.granted_at_key, userId: last.user_id, roleId: last.role_id, tenantId: last.tenant_id }),
      };
    }
    return { assignments };
  }

  async explainAccess(userId: string, tenantId: string | null, action?: string): Promise<AccessExplanation> {
    const roleWhere =
      tenantId === null
        ? sql`ur.user_id = ${userId} and ur.tenant_id is null`
        : sql`ur.user_id = ${userId} and (ur.tenant_id = ${tenantId} or ur.tenant_id is null)`;

    const { rows: roleRows } = await this.db.execute<{
      role_id: string;
      tenant_id: string | null;
      grants_all: boolean;
      actions: string[];
      expires_at: string | Date | null;
    }>(sql`
      select ur.role_id, ur.tenant_id, r.grants_all, ur.expires_at,
             coalesce(array_agg(rp.action order by rp.action) filter (where rp.action is not null), '{}') as actions
      from commons_authz_user_role ur
      join commons_authz_role r on r.id = ur.role_id
      left join commons_authz_role_permission rp on rp.role_id = r.id
      where ${roleWhere} and ${activeAssignment('ur')}
      group by ur.role_id, ur.tenant_id, r.grants_all, ur.expires_at
      order by ur.role_id
    `);

    const roles = roleRows.map((r) => ({
      roleId: r.role_id,
      tenantId: r.tenant_id,
      grantsAll: r.grants_all,
      grantedActions: r.grants_all ? [] : [...(r.actions ?? [])],
      expiresAt: r.expires_at == null ? null : asDate(r.expires_at),
    }));

    let delegations: AccessExplanation['delegations'] = [];
    if (tenantId !== null) {
      const { rows: delRows } = await this.db.execute<{
        id: string;
        granter_id: string;
        actions: string[];
        lapsed_actions: string[];
        expires_at: string | Date;
      }>(sql`
        select d.id, d.granter_id, d.actions, d.expires_at, ${LAPSED_ACTIONS}
        from commons_authz_delegation d
        where d.grantee_id = ${userId} and d.tenant_id = ${tenantId}
          and d.revoked_at is null and d.expires_at > now()
        order by d.created_at desc
      `);
      delegations = delRows.map((d) => {
        const lapsed = new Set(d.lapsed_actions ?? []);
        return {
          id: d.id,
          granterId: d.granter_id,
          actions: d.actions.filter((a) => !lapsed.has(a)),
          lapsedActions: [...lapsed],
          expiresAt: asDate(d.expires_at),
        };
      });
    }

    const grantsAllRole = roles.find((r) => r.grantsAll);
    const effectiveActions: string[] | '*' = grantsAllRole
      ? '*'
      : [...new Set([...roles.flatMap((r) => r.grantedActions), ...delegations.flatMap((d) => d.actions)])].sort();

    const explanation: AccessExplanation = { userId, tenantId, roles, delegations, effectiveActions };
    if (action !== undefined) {
      explanation.action = action;
      if (grantsAllRole) {
        explanation.allowed = true;
        explanation.reason = `granted by role '${grantsAllRole.roleId}' (grants all actions)`;
      } else {
        const viaRole = roles.find((r) => r.grantedActions.includes(action));
        const viaDelegation = delegations.find((d) => d.actions.includes(action));
        const lapsed = delegations.find((d) => d.lapsedActions.includes(action));
        if (viaRole) {
          explanation.allowed = true;
          explanation.reason = `granted by role '${viaRole.roleId}'`;
        } else if (viaDelegation) {
          explanation.allowed = true;
          explanation.reason = `granted by delegation ${viaDelegation.id} from ${viaDelegation.granterId} (expires ${viaDelegation.expiresAt.toISOString()})`;
        } else if (lapsed) {
          explanation.allowed = false;
          explanation.reason = `denied — delegation ${lapsed.id} from ${lapsed.granterId} lends '${action}', but the granter no longer holds it`;
        } else {
          explanation.allowed = false;
          explanation.reason = `denied — no role or active delegation grants '${action}'`;
        }
      }
    }
    return explanation;
  }

  async listDelegations(query: DelegationQuery = {}): Promise<DelegationPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_DELEGATION_LIMIT), MAX_DELEGATION_LIMIT);
    const conds: SQL[] = [];
    if (query.granterId !== undefined) conds.push(sql`d.granter_id = ${query.granterId}`);
    if (query.granteeId !== undefined) conds.push(sql`d.grantee_id = ${query.granteeId}`);
    if (query.userId !== undefined) conds.push(sql`(d.granter_id = ${query.userId} or d.grantee_id = ${query.userId})`);
    if (query.tenantId !== undefined) conds.push(sql`d.tenant_id = ${query.tenantId}`);
    if (query.status === 'active') conds.push(sql`d.revoked_at is null and d.expires_at > now()`);
    else if (query.status === 'revoked') conds.push(sql`d.revoked_at is not null`);
    else if (query.status === 'expired') conds.push(sql`d.revoked_at is null and d.expires_at <= now()`);
    if (query.lapsed) {
      conds.push(sql`d.revoked_at is null and d.expires_at > now()
        and exists (select 1 from unnest(d.actions) as la(action) where not ${granterStillHolds('d', sql`la.action`)})`);
    }
    if (query.expiringWithinDays !== undefined) {
      conds.push(
        sql`d.revoked_at is null and d.expires_at > now() and d.expires_at <= now() + (${query.expiringWithinDays} * interval '1 day')`,
      );
    }
    if (query.cursor) {
      const c = decodeCursor(query.cursor, ['ts', 'id']);
      if (!c) throw new InvalidAuthzCursorError(query.cursor);
      const ts = sql`${c.ts}::timestamptz`;
      // Led by created_at, so the scan starts at the boundary (an Index Cond); the OR alone is only a Filter.
      conds.push(sql`d.created_at <= ${ts} and (d.created_at < ${ts} or d.id < ${c.id}::uuid)`);
    }
    const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;

    const { rows } = await this.db.execute<DelegationRow>(sql`
      select d.id, d.granter_id, d.grantee_id, d.tenant_id, d.actions, d.expires_at, d.revoked_at, d.revoked_by,
             d.reason, d.created_at, d.created_by, ${LAPSED_ACTIONS}, ${isoMicros('d.created_at', 'created_at_key')}
      from commons_authz_delegation d
      ${where}
      order by d.created_at desc, d.id desc
      limit ${limit + 1}
    `);
    const page = rows.slice(0, limit);
    const delegations = page.map(toDelegationView);
    if (rows.length > limit) {
      const last = page[page.length - 1];
      return { delegations, nextCursor: encodeCursor({ ts: last.created_at_key, id: last.id }) };
    }
    return { delegations };
  }

  async getDelegation(id: string): Promise<DelegationView | null> {
    // Not a uuid → no such delegation (a 404), never a failed ::uuid cast (a 500).
    if (!UUID.test(id)) return null;
    const { rows } = await this.db.execute<DelegationRow>(sql`
      select d.id, d.granter_id, d.grantee_id, d.tenant_id, d.actions, d.expires_at, d.revoked_at, d.revoked_by,
             d.reason, d.created_at, d.created_by, ${LAPSED_ACTIONS}, ${isoMicros('d.created_at', 'created_at_key')}
      from commons_authz_delegation d
      where d.id = ${id}::uuid
    `);
    return rows[0] ? toDelegationView(rows[0]) : null;
  }

  async actionCatalogHealth(knownActions: readonly string[]): Promise<ActionCatalogHealth> {
    const { rows: actionRows } = await this.db.execute<{ name: string; description: string | null }>(
      sql`select name, description from commons_authz_action`,
    );
    const { rows: grantedRows } = await this.db.execute<{ action: string }>(
      sql`select distinct action from commons_authz_role_permission`,
    );

    const known = new Set(knownActions);
    const inDb = new Set(actionRows.map((r) => r.name));
    const granted = new Set(grantedRows.map((r) => r.action));
    const undescribed = new Set(
      actionRows.filter((r) => r.description === null || r.description.trim() === '').map((r) => r.name),
    );

    return {
      inCodeNotInDb: [...known].filter((a) => !inDb.has(a)).sort(),
      inDbNotInCode: [...inDb].filter((a) => !known.has(a)).sort(),
      grantedButUndescribed: [...granted].filter((a) => undescribed.has(a)).sort(),
      describedCount: actionRows.length - undescribed.size,
      totalCount: actionRows.length,
    };
  }

  async whoCan(action: string, tenantId?: string): Promise<WhoCanResult> {
    const tenantCond = tenantId === undefined ? sql`` : sql`and (ur.tenant_id = ${tenantId} or ur.tenant_id is null)`;
    const { rows: roleRows } = await this.db.execute<{ id: string; grants_all: boolean; holders: string[] | null }>(sql`
      select r.id, r.grants_all,
             array_agg(distinct ur.user_id order by ur.user_id) filter (where ur.user_id is not null) as holders
      from commons_authz_role r
      left join commons_authz_user_role ur on ur.role_id = r.id and ${activeAssignment('ur')} ${tenantCond}
      where r.grants_all or exists (
        select 1 from commons_authz_role_permission rp where rp.role_id = r.id and rp.action = ${action}
      )
      group by r.id, r.grants_all
      order by r.id
    `);

    const tenantDelCond = tenantId === undefined ? sql`` : sql`and d.tenant_id = ${tenantId}`;
    const { rows: delRows } = await this.db.execute<{
      id: string;
      granter_id: string;
      grantee_id: string;
      expires_at: string | Date;
    }>(sql`
      select d.id, d.granter_id, d.grantee_id, d.expires_at
      from commons_authz_delegation d
      where d.revoked_at is null and d.expires_at > now()
        and ${action} = any(d.actions)
        and ${granterStillHolds('d', sql`${action}`)}
        ${tenantDelCond}
      order by d.expires_at asc
    `);

    return {
      action,
      tenantId: tenantId ?? null,
      roles: roleRows.map((r) => ({ roleId: r.id, grantsAll: r.grants_all, holderUserIds: [...(r.holders ?? [])] })),
      delegations: delRows.map((d) => ({
        id: d.id,
        granterId: d.granter_id,
        granteeId: d.grantee_id,
        expiresAt: asDate(d.expires_at),
      })),
    };
  }

  async exactTenantHolders(action: string, tenantId: string | null): Promise<ActionHolder[]> {
    const tenantCond = tenantId === null ? sql`ur.tenant_id is null` : sql`ur.tenant_id = ${tenantId}`;
    const { rows } = await this.db.execute<{ user_id: string; role_id: string }>(sql`
      select ur.user_id, ur.role_id
      from commons_authz_user_role ur
      join commons_authz_role r on r.id = ur.role_id
      where ${tenantCond} and ${activeAssignment('ur')}
        and (r.grants_all or exists (
          select 1 from commons_authz_role_permission rp where rp.role_id = r.id and rp.action = ${action}
        ))
    `);
    return rows.map((r) => ({ userId: r.user_id, roleId: r.role_id }));
  }
  async accessStats(tenantId?: string): Promise<AccessStats> {
    // A tenant's own assignments (its people); everything when no tenant is given. Platform holders are counted
    // globally either way — a global role reaches every tenant.
    const reach = tenantId === undefined ? sql`true` : sql`ur.tenant_id = ${tenantId}`;
    const platformReach = tenantId === undefined ? sql`true` : sql`ur.tenant_id is null`;
    const delegationScope = tenantId === undefined ? sql`true` : sql`d.tenant_id = ${tenantId}`;
    const { rows: roleRows } = await this.db.execute<{ role_id: string; holders: string | number }>(sql`
      select ur.role_id, count(distinct ur.user_id) as holders
      from commons_authz_user_role ur
      where ${reach} and ${activeAssignment('ur')}
      group by ur.role_id
      order by ur.role_id
    `);
    const { rows: [totals] } = await this.db.execute<Record<string, string | number>>(sql`
      select
        (select count(distinct ur.user_id) from commons_authz_user_role ur where ${reach} and ${activeAssignment('ur')}) as users_with_role,
        (select count(distinct ur.user_id) from commons_authz_user_role ur
           join commons_authz_role r on r.id = ur.role_id
          where ${platformReach} and ${activeAssignment('ur')}
            and (r.grants_all or exists (
              select 1 from commons_authz_role_permission rp
              join commons_authz_action a on a.name = rp.action
              where rp.role_id = r.id and a.scope = 'platform'))) as platform_holders,
        (select count(*) from commons_authz_user_role ur
          where ${reach} and ur.expires_at > now() and ur.expires_at <= now() + interval '7 days') as assignments_expiring,
        (select count(*) from commons_authz_delegation d
          where ${delegationScope} and d.revoked_at is null and d.expires_at > now()) as active_delegations,
        (select count(*) from commons_authz_delegation d
          where ${delegationScope} and d.revoked_at is null and d.expires_at > now()
            and d.expires_at <= now() + interval '7 days') as delegations_expiring,
        (select count(*) from commons_authz_delegation d
          where ${delegationScope} and d.revoked_at is null and d.expires_at > now()
            and exists (select 1 from unnest(d.actions) as la(action) where not ${granterStillHolds('d', sql`la.action`)})) as lapsed_delegations
    `);
    return {
      tenantId: tenantId ?? null,
      usersWithRole: Number(totals?.users_with_role ?? 0),
      roleHolders: roleRows.map((r) => ({ roleId: r.role_id, holders: Number(r.holders) })),
      platformHolders: Number(totals?.platform_holders ?? 0),
      activeDelegations: Number(totals?.active_delegations ?? 0),
      lapsedDelegations: Number(totals?.lapsed_delegations ?? 0),
      delegationsExpiring7d: Number(totals?.delegations_expiring ?? 0),
      assignmentsExpiring7d: Number(totals?.assignments_expiring ?? 0),
    };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RoleRow {
  id: string;
  description: string | null;
  grants_all: boolean;
  actions: string[] | null;
  platform_actions: string[] | null;
}

function toRoleView(r: RoleRow): RoleView {
  const platformActions = r.grants_all ? [] : [...(r.platform_actions ?? [])];
  const scope: ActionScope = r.grants_all || platformActions.length > 0 ? 'platform' : 'tenant';
  return {
    id: r.id,
    description: r.description,
    grantsAll: r.grants_all,
    actions: r.grants_all ? [] : [...(r.actions ?? [])],
    scope,
    platformActions,
  };
}

interface AssignmentRow {
  user_id: string;
  tenant_id: string | null;
  role_id: string;
  granted_at: string | Date;
  granted_by: string | null;
  expires_at: string | Date | null;
  granted_at_key: string;
}

function toAssignment(r: AssignmentRow): UserRoleAssignment {
  const expiresAt = r.expires_at == null ? null : asDate(r.expires_at);
  return {
    userId: r.user_id,
    tenantId: r.tenant_id,
    roleId: r.role_id,
    grantedAt: asDate(r.granted_at),
    grantedBy: r.granted_by,
    expiresAt,
    status: expiresAt && expiresAt.getTime() <= Date.now() ? 'expired' : 'active',
  };
}

interface DelegationRow {
  id: string;
  granter_id: string;
  grantee_id: string;
  tenant_id: string;
  actions: string[];
  lapsed_actions: string[] | null;
  expires_at: string | Date;
  revoked_at: string | Date | null;
  revoked_by: string | null;
  reason: string | null;
  created_at: string | Date;
  created_by: string;
  created_at_key: string;
}

function toDelegationView(row: DelegationRow): DelegationView {
  const expiresAt = asDate(row.expires_at);
  const revokedAt = row.revoked_at === null ? null : asDate(row.revoked_at);
  const status: DelegationView['status'] = revokedAt
    ? 'revoked'
    : expiresAt.getTime() <= Date.now()
      ? 'expired'
      : 'active';
  return {
    id: row.id,
    granterId: row.granter_id,
    granteeId: row.grantee_id,
    tenantId: row.tenant_id,
    actions: row.actions,
    lapsedActions: [...(row.lapsed_actions ?? [])],
    expiresAt,
    revokedAt,
    revokedBy: row.revoked_by,
    reason: row.reason,
    createdAt: asDate(row.created_at),
    createdBy: row.created_by,
    status,
  };
}

function asDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}
