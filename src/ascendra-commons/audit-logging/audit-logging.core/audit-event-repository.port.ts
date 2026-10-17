import type { AuditEventInput } from './audit-event.interface';

/** The persistence port — never imported by feature code directly, only by persist-audit-record.ts's caller. */
export interface AuditEventRepository {
  insert(record: AuditEventInput): Promise<void>;
}
