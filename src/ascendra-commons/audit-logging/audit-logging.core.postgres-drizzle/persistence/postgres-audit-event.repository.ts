import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { AuditEventInput, AuditEventRepository } from '../../audit-logging.core';
import type { SqlExecutor } from './sql-executor';
import { AUDIT_APPLICATION_ID, AUDIT_SQL_EXECUTOR } from '../tokens';

/**
 * Reference `AuditEventRepository` for Postgres via Drizzle — one library-owned
 * `INSERT`, no project-specific logic, the same shape `idempotency-key`' and
 * `background-jobs`' own Postgres implementations take. A consumer on this
 * stack wires it through `PostgresAuditPersistenceModule` and writes none of
 * this; a consumer on a different stack provides its own `AuditEventRepository`
 * instead (the port is unchanged either way).
 *
 * Corresponding table: `audit-event.schema.ts` (DDL: `../migrations/`) — the
 * column list below must match it.
 *
 * Write-once by construction: this class exposes `insert()` only, mirroring the
 * port. No `update`/`delete` path exists to call.
 */
@Injectable()
export class PostgresAuditEventRepository implements AuditEventRepository {
  constructor(
    @Inject(AUDIT_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(AUDIT_APPLICATION_ID) private readonly application: string,
  ) {}

  async insert(record: AuditEventInput): Promise<void> {
    // `application` is stamped here, never a field `AuditEventInput` carries —
    // it's an ambient fact about this process, not about the change being audited.
    await this.db.execute(sql`
      insert into commons_audit_event (
        entity_type, entity_id, tenant_id, actor, action,
        before, after, correlation_id, reason, occurred_at, application
      ) values (
        ${record.entityType}, ${record.entityId}, ${record.tenantId}, ${record.actor}, ${record.action},
        ${this.jsonb(record.before)}, ${this.jsonb(record.after)}, ${record.correlationId}, ${record.reason},
        ${record.occurredAt}, ${this.application}
      )
    `);
  }

  /** `null` stays a real SQL NULL; an object is bound as text and cast, never string-interpolated. */
  private jsonb(value: Record<string, unknown> | null): SQL | null {
    return value === null ? null : sql`${JSON.stringify(value)}::jsonb`;
  }
}
