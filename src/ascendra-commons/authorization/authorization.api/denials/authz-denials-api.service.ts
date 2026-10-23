import { Inject, Injectable, NotImplementedException, Optional } from '@nestjs/common';
import type { Actor } from '../../authorization.core';
import {
  ACCESS_DENIAL_OBSERVABILITY_PORT,
  type AccessDenialObservabilityPort,
  type AccessDenialSummary,
  type AccessDenialView,
} from '../../authorization.core.permission-table';
import { AuthzAccessScope } from '../shared/access-scope';
import { mapErrors } from '../shared/errors';
import { cursorList, dateParam, idParam, positiveIntParam } from '../shared/params';

export interface DenialListQuery {
  actorId?: string;
  tenantId?: string;
  action?: string;
  correlationId?: string;
  since?: string;
  until?: string;
  limit?: string;
  cursor?: string;
}

const NO_LOG =
  'The denied-requests log is not wired — bind PostgresAccessDenialRecorderModule to AuthorizationModule ' +
  '(denialRecorderToken) and import PostgresAccessDenialObservabilityModule here.';

/** The denied-requests log — every 403 the guard answered. A tenant admin sees its own tenant's actors only. */
@Injectable()
export class AuthzDenialsApiService {
  constructor(
    @Inject(AuthzAccessScope) private readonly scope: AuthzAccessScope,
    @Optional() @Inject(ACCESS_DENIAL_OBSERVABILITY_PORT) private readonly port?: AccessDenialObservabilityPort,
  ) {}

  async list(actor: Actor, query: DenialListQuery) {
    const port = this.requirePort();
    const tenantId = await this.scope.readTenant(actor, idParam('tenantId', query.tenantId, true));
    const page = await mapErrors(() =>
      port.listDenials({
        actorId: idParam('actorId', query.actorId, true),
        tenantId,
        action: idParam('action', query.action, true),
        correlationId: idParam('correlationId', query.correlationId, true),
        since: dateParam('since', query.since),
        until: dateParam('until', query.until),
        limit: positiveIntParam('limit', query.limit),
        cursor: query.cursor,
      }),
    );
    return cursorList<AccessDenialView>(page.denials, page.nextCursor);
  }

  async summary(actor: Actor, query: { tenantId?: string; since?: string }): Promise<AccessDenialSummary> {
    const port = this.requirePort();
    const tenantId = await this.scope.readTenant(actor, idParam('tenantId', query.tenantId, true));
    return port.denialSummary({ tenantId, since: dateParam('since', query.since) });
  }

  private requirePort(): AccessDenialObservabilityPort {
    if (!this.port) throw new NotImplementedException(NO_LOG);
    return this.port;
  }
}
