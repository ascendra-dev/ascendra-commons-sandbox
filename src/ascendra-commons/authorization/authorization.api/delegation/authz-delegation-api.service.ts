import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '../../authorization.core';
import {
  AUTHZ_DELEGATION_SERVICE,
  AUTHZ_OBSERVABILITY_PORT,
  type AuthzObservabilityPort,
  type DelegationRecord,
  type DelegationService,
} from '../../authorization.core.permission-table';
import { AUTHZ_ACTIONS } from '../authz-api.options';
import type { AuthzAuditEmitter } from '../authz-audit.port';
import type { CreateDelegationBody } from '../dto/authz-api.dto';
import { AuthzAccessScope } from '../shared/access-scope';
import { mapErrors } from '../shared/errors';
import { dateParam, idListParam, idParam, textParam } from '../shared/params';
import { AUTHZ_AUDIT_EMITTER } from '../tokens';

/**
 * Delegation — one user lending a subset of their own role-derived actions to another, in their tenant, until an
 * expiry. The granter, tenant and creator are always the request actor. Only tenant-scope actions can be lent (a
 * delegation lives in one tenant), never to yourself. A delegation grants only while its granter still holds the
 * action — the resolver re-checks at every use.
 */
@Injectable()
export class AuthzDelegationApiService {
  constructor(
    @Inject(AUTHZ_DELEGATION_SERVICE) private readonly delegation: DelegationService,
    @Inject(AUTHZ_OBSERVABILITY_PORT) private readonly observability: AuthzObservabilityPort,
    @Inject(AuthzAccessScope) private readonly scope: AuthzAccessScope,
    @Inject(AUTHZ_AUDIT_EMITTER) private readonly audit: AuthzAuditEmitter,
  ) {}

  async create(actor: Actor, body: CreateDelegationBody): Promise<DelegationRecord> {
    if (actor.tenantId === null) throw new ForbiddenException('Delegation happens inside a tenant — you have none.');
    const granteeId = idParam('granteeId', body?.granteeId);
    if (granteeId === actor.id) throw new BadRequestException("You can't delegate to yourself.");
    const requestedTenant = body?.tenantId === undefined ? undefined : idParam('tenantId', body.tenantId);
    if (requestedTenant !== undefined && requestedTenant !== actor.tenantId) {
      throw new ForbiddenException('You can only delegate in your own tenant.');
    }
    const actions = idListParam('actions', body?.actions, 100);
    const expiresAt = dateParam('expiresAt', body?.expiresAt);
    if (!expiresAt) throw new BadRequestException('"expiresAt" is required');
    const reason = textParam('reason', body?.reason, 500);

    const catalog = new Map((await this.observability.listActions()).map((a) => [a.name, a]));
    const unknown = actions.filter((a) => !catalog.has(a));
    if (unknown.length > 0) throw new BadRequestException(`Unknown action(s): ${unknown.join(', ')}`);
    const platformWide = actions.filter((a) => catalog.get(a)!.scope === 'platform');
    if (platformWide.length > 0) {
      throw new BadRequestException(`Platform-wide actions can't be lent inside a tenant: ${platformWide.join(', ')}`);
    }

    const record = await mapErrors(() =>
      this.delegation.delegate({
        granterId: actor.id,
        granteeId,
        tenantId: actor.tenantId!,
        actions,
        expiresAt,
        reason,
        createdBy: actor.id,
      }),
    );
    await this.audit.record({
      action: 'authz.delegation_granted',
      actorId: actor.id,
      tenantId: actor.tenantId,
      entityType: 'delegation',
      entityId: record.id,
      after: { granteeId: record.granteeId, actions: record.actions, expiresAt: record.expiresAt },
    });
    return record;
  }

  /**
   * The granter or grantee may revoke it; so may whoever manages roles in its tenant, or a platform admin. Another
   * tenant's delegation is a 404 — its existence isn't this actor's to learn. Revoking a revoked one changes nothing.
   */
  async revoke(actor: Actor, idParamValue: string): Promise<void> {
    const id = idParam('id', idParamValue);
    const delegation = await this.observability.getDelegation(id);
    const platform = await this.scope.isPlatform(actor);
    if (!delegation || (!platform && delegation.tenantId !== actor.tenantId)) {
      throw new NotFoundException(`No delegation "${id}"`);
    }
    const party = delegation.granterId === actor.id || delegation.granteeId === actor.id;
    if (!party && !platform && !(await this.scope.heldActions(actor, [AUTHZ_ACTIONS.ASSIGN_ROLES])).size) {
      throw new ForbiddenException("Only its granter, its grantee or an admin who manages roles can revoke a delegation.");
    }
    if (delegation.revokedAt) return;

    await this.delegation.revokeDelegation(id, actor.id);
    await this.audit.record({
      action: 'authz.delegation_revoked',
      actorId: actor.id,
      tenantId: delegation.tenantId,
      entityType: 'delegation',
      entityId: id,
      before: { granterId: delegation.granterId, granteeId: delegation.granteeId, actions: delegation.actions },
    });
  }

  listMine(actor: Actor) {
    return this.delegation.listDelegations(actor);
  }
}
