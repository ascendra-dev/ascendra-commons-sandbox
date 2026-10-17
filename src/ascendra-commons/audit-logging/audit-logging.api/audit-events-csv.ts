import type { AuditEvent } from '../audit-logging.core';

/**
 * Streams `AuditEvent`s as CSV, for `GET /audit/events.csv` (api-contract Rule 9):
 * the header row, then one chunk per page the export walks. The row cap lives in
 * `AuditEventsApiService.exportEvents`; there is deliberately no unbounded/async
 * export-to-file-storage flow here (see the module README's "what's not built" —
 * that's a separate, explicitly out-of-scope piece of work).
 *
 * `before`/`after` are serialized as JSON strings, one column each — a
 * spreadsheet consumer can still read the flat fields without them.
 */
const COLUMNS = [
  'id',
  'occurredAt',
  'entityType',
  'entityId',
  'tenantId',
  'actor',
  'action',
  'before',
  'after',
  'correlationId',
  'reason',
  'application',
] as const;

export async function* streamAuditEventsCsv(pages: AsyncIterable<readonly AuditEvent[]>): AsyncGenerator<string> {
  yield COLUMNS.join(',') + '\r\n';
  for await (const records of pages) {
    if (records.length > 0) yield records.map(renderRow).join('');
  }
}

function renderRow(record: AuditEvent): string {
  return (
    [
      record.id,
      record.occurredAt.toISOString(),
      record.entityType,
      record.entityId,
      record.tenantId ?? '',
      record.actor,
      record.action,
      record.before ? JSON.stringify(record.before) : '',
      record.after ? JSON.stringify(record.after) : '',
      record.correlationId,
      record.reason ?? '',
      record.application,
    ]
      .map(csvField)
      .join(',') + '\r\n'
  );
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
