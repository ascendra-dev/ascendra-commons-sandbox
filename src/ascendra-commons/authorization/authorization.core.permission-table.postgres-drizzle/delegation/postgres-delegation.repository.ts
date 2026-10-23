import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  deriveDelegationStatus,
  type CreateDelegationInput,
  type DelegationRecord,
  type DelegationRepository,
} from '../../authorization.core.permission-table';
import { textArray } from '../persistence/sql-helpers';
import type { SqlExecutor } from '../persistence/sql-executor';
import { AUTHZ_SQL_EXECUTOR } from '../tokens';

/**
 * `DelegationRepository` for Postgres/Drizzle — a straight write/read over
 * `commons_authz_delegation`. All grant-time validation happens in
 * `DelegationService` (stack-agnostic) before `insert` is called.
 */
@Injectable()
export class PostgresDelegationRepository implements DelegationRepository {
  constructor(@Inject(AUTHZ_SQL_EXECUTOR) private readonly db: SqlExecutor) {}

  async insert(input: CreateDelegationInput): Promise<DelegationRecord> {
    const { rows } = await this.db.execute<DelegationRow>(sql`
      INSERT INTO commons_authz_delegation (granter_id, grantee_id, tenant_id, actions, expires_at, reason, created_by)
      VALUES (
        ${input.granterId}, ${input.granteeId}, ${input.tenantId}, ${textArray(input.actions)},
        ${input.expiresAt}, ${input.reason ?? null}, ${input.createdBy ?? input.granterId}
      )
      RETURNING id, granter_id, grantee_id, tenant_id, actions, expires_at, revoked_at, reason, created_at
    `);
    return toRecord(rows[0]);
  }

  async revoke(id: string, revokedBy: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE commons_authz_delegation SET revoked_at = now(), revoked_by = ${revokedBy}
      WHERE id = ${id} AND revoked_at IS NULL
    `);
  }

  async getById(id: string): Promise<DelegationRecord | null> {
    const { rows } = await this.db.execute<DelegationRow>(sql`
      SELECT id, granter_id, grantee_id, tenant_id, actions, expires_at, revoked_at, reason, created_at
      FROM commons_authz_delegation
      WHERE id = ${id}
    `);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async listForActor(actorId: string, tenantId: string | null): Promise<DelegationRecord[]> {
    const { rows } = await this.db.execute<DelegationRow>(sql`
      SELECT id, granter_id, grantee_id, tenant_id, actions, expires_at, revoked_at, reason, created_at
      FROM commons_authz_delegation
      WHERE tenant_id = ${tenantId}
        AND (granter_id = ${actorId} OR grantee_id = ${actorId})
      ORDER BY created_at DESC
    `);
    return rows.map(toRecord);
  }
}

interface DelegationRow {
  id: string;
  granter_id: string;
  grantee_id: string;
  tenant_id: string;
  actions: string[];
  expires_at: string | Date;
  revoked_at: string | Date | null;
  reason: string | null;
  created_at: string | Date;
}

function toRecord(row: DelegationRow): DelegationRecord {
  const expiresAt = new Date(row.expires_at);
  const revokedAt = row.revoked_at === null ? null : new Date(row.revoked_at);
  return {
    id: row.id,
    granterId: row.granter_id,
    granteeId: row.grantee_id,
    tenantId: row.tenant_id,
    actions: row.actions,
    expiresAt,
    revokedAt,
    reason: row.reason,
    createdAt: new Date(row.created_at),
    status: deriveDelegationStatus(expiresAt, revokedAt),
  };
}
