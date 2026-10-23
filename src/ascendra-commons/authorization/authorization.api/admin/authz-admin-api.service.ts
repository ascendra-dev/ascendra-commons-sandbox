import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '../../authorization.core';
import {
  AUTHZ_ADMIN_PORT,
  AUTHZ_OBSERVABILITY_PORT,
  type AuthzAdminPort,
  type AuthzObservabilityPort,
  type RoleView,
} from '../../authorization.core.permission-table';
import { AUTHZ_ACTIONS } from '../authz-api.options';
import type { AuthzAuditEmitter } from '../authz-audit.port';
import type { AssignRoleBody, BulkAssignBody, RevokeRoleQuery } from '../dto/authz-api.dto';
import { AuthzAccessScope } from '../shared/access-scope';
import { mapErrors } from '../shared/errors';
import { futureDateParam, idListParam, idParam, textParam } from '../shared/params';
import { AUTHZ_AUDIT_EMITTER } from '../tokens';

/** A role, and whether this actor may assign it in a tenant — `reason` says why not. */
export interface AssignableRoleView extends RoleView {
  assignable: boolean;
  reason?: string;
}

export interface BulkAssignResult {
  assigned: string[];
}

/**
 * Role assignment, with what `@RequiresAction` can't express:
 *
 * - **Tenant ceiling** — anyone but a platform admin assigns and revokes in their own tenant only; `grantedBy` is
 *   always the request actor.
 * - **Role ceiling** — a role holding a platform-scope action (or granting all) is assigned globally only, by a
 *   platform admin: inside a tenant it would hand a tenant user every tenant's data. And anyone but a platform admin
 *   may only grant (or take away) a role whose every action they hold themselves.
 * - **Lockout** — no one removes their own access to manage roles, and a tenant always keeps one user who can
 *   (`authz.assign_roles`); the platform always keeps one `authz.platform` holder.
 * - **Audit** — each change emits an `AuthzAuditEvent` through the optional `AUTHZ_AUDIT_EMITTER`.
 */
@Injectable()
export class AuthzAdminApiService {
  constructor(
    @Inject(AUTHZ_ADMIN_PORT) private readonly admin: AuthzAdminPort,
    @Inject(AUTHZ_OBSERVABILITY_PORT) private readonly observability: AuthzObservabilityPort,
    @Inject(AuthzAccessScope) private readonly scope: AuthzAccessScope,
    @Inject(AUTHZ_AUDIT_EMITTER) private readonly audit: AuthzAuditEmitter,
  ) {}

  async assignRole(actor: Actor, userIdParam: string, body: AssignRoleBody): Promise<void> {
    const userId = idParam('userId', userIdParam);
    const roleId = idParam('roleId', body?.roleId);
    const expiresAt = futureDateParam('expiresAt', body?.expiresAt) ?? null;
    const tenantId = await this.scope.writeTenant(actor, tenantBody(body?.tenantId));
    await this.assertAssignable(actor, await this.role(roleId), tenantId);

    await mapErrors(() => this.admin.assignRole({ userId, tenantId, roleId, grantedBy: actor.id, expiresAt }));
    await this.audit.record({
      action: 'authz.role_assigned',
      actorId: actor.id,
      tenantId,
      entityType: 'user_role',
      entityId: `${userId}:${roleId}`,
      after: { userId, tenantId, roleId, expiresAt },
    });
  }

  /** One role to many users — onboarding a cohort. All-or-nothing on the checks; each assignment audited. */
  async assignMany(actor: Actor, roleIdParam: string, body: BulkAssignBody): Promise<BulkAssignResult> {
    const roleId = idParam('roleId', roleIdParam);
    const userIds = idListParam('userIds', body?.userIds);
    const expiresAt = futureDateParam('expiresAt', body?.expiresAt) ?? null;
    const tenantId = await this.scope.writeTenant(actor, tenantBody(body?.tenantId));
    await this.assertAssignable(actor, await this.role(roleId), tenantId);

    for (const userId of userIds) {
      await mapErrors(() => this.admin.assignRole({ userId, tenantId, roleId, grantedBy: actor.id, expiresAt }));
      await this.audit.record({
        action: 'authz.role_assigned',
        actorId: actor.id,
        tenantId,
        entityType: 'user_role',
        entityId: `${userId}:${roleId}`,
        after: { userId, tenantId, roleId, expiresAt },
      });
    }
    return { assigned: userIds };
  }

  async revokeRole(actor: Actor, userIdParam: string, roleIdParam: string, query: RevokeRoleQuery): Promise<void> {
    const userId = idParam('userId', userIdParam);
    const roleId = idParam('roleId', roleIdParam);
    const tenantId = await this.scope.writeTenant(actor, tenantQuery(query));
    const role = await this.role(roleId);
    // Taking a role away is bound by the same ceiling as handing it out.
    await this.assertAssignable(actor, role, tenantId);
    await this.assertNotLockingOut(actor, userId, role, tenantId);

    const removed = await this.admin.revokeRole({ userId, tenantId, roleId });
    if (!removed) throw new NotFoundException(`${userId} doesn't hold '${roleId}' ${tenantId === null ? 'globally' : `in ${tenantId}`}`);
    await this.audit.record({
      action: 'authz.role_revoked',
      actorId: actor.id,
      tenantId,
      entityType: 'user_role',
      entityId: `${userId}:${roleId}`,
      before: { userId, tenantId, roleId },
    });
  }

  /** Every role, with whether this actor may assign it in `tenantId` (its own when omitted) — for a role picker. */
  async assignableRoles(actor: Actor, requestedTenant: string | undefined): Promise<AssignableRoleView[]> {
    const tenantId = await this.scope.writeTenant(actor, requestedTenant);
    const roles = await this.observability.listRoles();
    return Promise.all(
      roles.map(async (role) => {
        const reason = await this.whyNotAssignable(actor, role, tenantId);
        return reason ? { ...role, assignable: false, reason } : { ...role, assignable: true };
      }),
    );
  }

  async setActionDescription(actor: Actor, actionParam: string, descriptionParam: unknown): Promise<void> {
    const action = idParam('name', actionParam);
    const description = textParam('description', descriptionParam, 500) ?? null;
    // The catalog is every tenant's — describing it is the platform's.
    if (!(await this.scope.isPlatform(actor))) throw new ForbiddenException('Only a platform admin can describe actions.');
    await mapErrors(() => this.admin.setActionDescription(action, description));
    await this.audit.record({
      action: 'authz.action_described',
      actorId: actor.id,
      tenantId: null,
      entityType: 'action_catalog',
      entityId: action,
      after: { description },
    });
  }

  private async role(roleId: string): Promise<RoleView> {
    const role = await this.observability.getRole(roleId);
    if (!role) throw new NotFoundException(`No role '${roleId}' in the role catalog.`);
    return role;
  }

  private async assertAssignable(actor: Actor, role: RoleView, tenantId: string | null): Promise<void> {
    const reason = await this.whyNotAssignable(actor, role, tenantId);
    if (reason) throw new ForbiddenException(reason);
  }

  private async whyNotAssignable(actor: Actor, role: RoleView, tenantId: string | null): Promise<string | undefined> {
    const platform = await this.scope.isPlatform(actor);
    if (tenantId === null) {
      return platform ? undefined : 'Only a platform admin can make an all-tenant assignment.';
    }
    if (role.grantsAll) return `'${role.id}' grants every action — it can only be assigned to all tenants, by a platform admin.`;
    if (role.platformActions.length > 0) {
      return `'${role.id}' grants platform-wide actions (${role.platformActions.join(', ')}) — it can only be assigned to all tenants, by a platform admin.`;
    }
    if (platform) return undefined;
    const held = await this.scope.heldActions(actor, role.actions);
    const missing = role.actions.filter((a) => !held.has(a));
    return missing.length > 0 ? `You can only hand on actions you hold — '${role.id}' also grants ${missing.join(', ')}.` : undefined;
  }

  private async assertNotLockingOut(actor: Actor, userId: string, role: RoleView, tenantId: string | null): Promise<void> {
    const guarded = tenantId === null ? AUTHZ_ACTIONS.PLATFORM : AUTHZ_ACTIONS.ASSIGN_ROLES;
    if (!role.grantsAll && !role.actions.includes(guarded)) return;

    const holders = await this.observability.exactTenantHolders(guarded, tenantId);
    const remaining = new Set(holders.filter((h) => !(h.userId === userId && h.roleId === role.id)).map((h) => h.userId));
    if (actor.id === userId && !remaining.has(userId)) {
      throw new ConflictException(`You can't remove your own ${guarded} — ask another admin to.`);
    }
    if (remaining.size === 0) {
      throw new ConflictException(
        tenantId === null
          ? `${userId} is the last holder of ${guarded} — assign it to someone else first.`
          : `${userId} is the last user who can manage roles in ${tenantId} — assign it to someone else first.`,
      );
    }
  }
}

/** A body's `tenantId`: a string, `null` (all tenants), or absent. */
function tenantBody(value: unknown): string | null | undefined {
  if (value === null) return null;
  return idParam('tenantId', value, true);
}

/** A revoke's tenant from the query: `?tenantId=t1`, `?global=true` (the all-tenant assignment), or neither. */
function tenantQuery(query: RevokeRoleQuery | undefined): string | null | undefined {
  if (query?.global === 'true') return null;
  return idParam('tenantId', query?.tenantId, true);
}
