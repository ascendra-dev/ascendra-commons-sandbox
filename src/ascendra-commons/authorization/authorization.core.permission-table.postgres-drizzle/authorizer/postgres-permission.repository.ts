import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PermissionRepository, RolePermissionSet } from '../../authorization.core.permission-table';
import { activeAssignment, granterStillHolds } from '../persistence/sql-helpers';
import type { SqlExecutor } from '../persistence/sql-executor';
import { AUTHZ_SQL_EXECUTOR } from '../tokens';

/**
 * `PermissionRepository` for Postgres/Drizzle — the two reads `PermissionResolver`
 * needs, against `commons_authz_*`. The resolution algorithm, the cache, and the
 * `Authorizer` itself are stack-agnostic (`authorization.core.permission-table`);
 * this class is only the SQL.
 */
@Injectable()
export class PostgresPermissionRepository implements PermissionRepository {
  constructor(@Inject(AUTHZ_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async loadRolePermissions(userId: string, tenantId: string | null): Promise<RolePermissionSet> {
    const { rows } = await this.db.execute<{ action: string | null; grants_all: boolean }>(sql`
      SELECT rp.action, bool_or(r.grants_all) OVER () AS grants_all
      FROM commons_authz_user_role ur
      JOIN commons_authz_role r ON r.id = ur.role_id
      LEFT JOIN commons_authz_role_permission rp ON rp.role_id = r.id
      WHERE ur.user_id = ${userId}
        AND (ur.tenant_id = ${tenantId} OR ur.tenant_id IS NULL)
        AND ${activeAssignment('ur')}
    `);
    return {
      grantsAll: rows.some((r) => r.grants_all),
      actions: rows.map((r) => r.action).filter((a): a is string => a !== null),
    };
  }

  async loadActiveDelegatedActions(granteeId: string, tenantId: string): Promise<string[]> {
    // Only what each granter still holds from a role — a delegation lends, it doesn't copy.
    const { rows } = await this.db.execute<{ action: string }>(sql`
      SELECT DISTINCT da.action
      FROM commons_authz_delegation d
      CROSS JOIN LATERAL unnest(d.actions) AS da(action)
      WHERE d.grantee_id = ${granteeId}
        AND d.tenant_id = ${tenantId}
        AND d.revoked_at IS NULL
        AND d.expires_at > now()
        AND ${granterStillHolds('d', sql`da.action`)}
    `);
    return rows.map((r) => r.action);
  }
}
