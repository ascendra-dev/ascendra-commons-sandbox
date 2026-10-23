import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '../../authorization.core';
import {
  AUTHZ_OBSERVABILITY_PORT,
  type DelegationStatus,
  type AccessExplanation,
  type ActionView,
  type AssignmentStatus,
  type AuthzObservabilityPort,
  type DelegationView,
  type RoleDetail,
  type RoleView,
  type UserRoleAssignment,
  type WhoCanResult,
} from '../../authorization.core.permission-table';
import type { AuthzApiOptions } from '../authz-api.options';
import type { AssignmentListQuery, DelegationListQuery, ExplainAccessQuery, WhoCanQuery } from '../dto/authz-api.dto';
import { AuthzAccessScope } from '../shared/access-scope';
import { mapErrors } from '../shared/errors';
import { booleanParam, cursorList, enumParam, idParam, positiveIntParam, withinDaysParam } from '../shared/params';
import { AUTHZ_API_OPTIONS } from '../tokens';

const ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = ['active', 'expired'];
/** `lapsed` — active, but lending something the granter no longer holds. */
const DELEGATION_STATUSES = ['active', 'expired', 'revoked', 'lapsed'] as const;

/**
 * The console's reads over `AuthzObservabilityPort`. Every one is tenant-scoped for anyone but a platform admin —
 * their own tenant's assignments, delegations, explanations and holders, never another's (`AuthzAccessScope`). Every
 * bad param is a 400; a role, delegation or user that isn't there (or isn't theirs to see) a 404.
 */
@Injectable()
export class AuthzObservabilityApiService {
  constructor(
    @Inject(AUTHZ_OBSERVABILITY_PORT) private readonly port: AuthzObservabilityPort,
    @Inject(AUTHZ_API_OPTIONS) private readonly options: AuthzApiOptions,
    @Inject(AuthzAccessScope) private readonly scope: AuthzAccessScope,
  ) {}

  /** The role catalog is the app's, the same for every tenant — every viewer sees it, with each role's scope. */
  listRoles(): Promise<RoleView[]> {
    return this.port.listRoles();
  }

  /** One role, with its active holders — in the viewer's tenant unless a platform admin. */
  async getRole(actor: Actor, idValue: string): Promise<RoleDetail> {
    const id = idParam('id', idValue);
    const role = await this.port.getRole(id);
    if (!role) throw new NotFoundException(`No role '${id}' in the role catalog.`);
    const tenantId = await this.scope.readTenant(actor, undefined);
    return { ...role, holderCount: await this.port.countHolders(id, tenantId) };
  }

  listActions(): Promise<ActionView[]> {
    return this.port.listActions();
  }

  async listAssignments(actor: Actor, query: AssignmentListQuery) {
    const platform = await this.scope.isPlatform(actor);
    const global = booleanParam('global', query.global);
    if (global && !platform) throw new ForbiddenException('All-tenant assignments are the platform admins’.');
    const tenantId = global ? null : await this.scope.readTenant(actor, idParam('tenantId', query.tenantId, true));
    const page = await mapErrors(() =>
      this.port.listUserRoleAssignments({
        userId: idParam('userId', query.userId, true),
        roleId: idParam('roleId', query.roleId, true),
        tenantId,
        status: enumParam('status', query.status, ASSIGNMENT_STATUSES),
        expiringWithinDays: query.expiring === undefined ? undefined : withinDaysParam(query.expiring),
        limit: positiveIntParam('limit', query.limit),
        cursor: query.cursor,
      }),
    );
    return cursorList<UserRoleAssignment>(page.assignments, page.nextCursor);
  }

  async listDelegations(actor: Actor, query: DelegationListQuery, expiringWithin?: string) {
    const tenantId = await this.scope.readTenant(actor, idParam('tenantId', query.tenantId, true));
    const page = await mapErrors(() =>
      this.port.listDelegations({
        granterId: idParam('granterId', query.granterId, true),
        granteeId: idParam('granteeId', query.granteeId, true),
        userId: idParam('userId', query.userId, true),
        tenantId,
        ...delegationStatus(enumParam('status', query.status, DELEGATION_STATUSES)),
        expiringWithinDays: expiringWithin === undefined ? undefined : withinDaysParam(expiringWithin),
        limit: positiveIntParam('limit', query.limit),
        cursor: query.cursor,
      }),
    );
    return cursorList<DelegationView>(page.delegations, page.nextCursor);
  }

  async getDelegation(actor: Actor, idValue: string): Promise<DelegationView> {
    const id = idParam('id', idValue);
    const delegation = await this.port.getDelegation(id);
    if (!delegation || (!(await this.scope.isPlatform(actor)) && delegation.tenantId !== actor.tenantId)) {
      throw new NotFoundException(`No delegation "${id}"`);
    }
    return delegation;
  }

  /** "Can this user do X, and why" — in the viewer's own tenant unless a platform admin (who may also ask globally). */
  async explainAccess(actor: Actor, query: ExplainAccessQuery): Promise<AccessExplanation> {
    const userId = idParam('userId', query.userId);
    const tenantId = (await this.scope.readTenant(actor, idParam('tenantId', query.tenantId, true))) ?? null;
    return this.port.explainAccess(userId, tenantId, idParam('action', query.action, true));
  }

  /** Your own access, in your own tenant — for any signed-in user. */
  myAccess(actor: Actor): Promise<AccessExplanation> {
    return this.port.explainAccess(actor.id, actor.tenantId);
  }

  async whoCan(actor: Actor, query: WhoCanQuery): Promise<WhoCanResult> {
    const action = idParam('action', query.action);
    const tenantId = await this.scope.readTenant(actor, idParam('tenantId', query.tenantId, true));
    return this.port.whoCan(action, tenantId);
  }

  actionCatalogHealth() {
    return this.port.actionCatalogHealth(this.options.actionCatalog);
  }
}

function delegationStatus(status: (typeof DELEGATION_STATUSES)[number] | undefined): { status?: DelegationStatus; lapsed?: boolean } {
  return status === 'lapsed' ? { status: 'active', lapsed: true } : { status };
}
