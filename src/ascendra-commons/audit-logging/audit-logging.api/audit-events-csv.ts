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

/**
 * A spreadsheet runs a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return as a formula — and these
 * files are opened in spreadsheets. `reason` is free text, and actors and entity ids can come from users, so such a
 * value gets a leading `'`, which makes it plain text (OWASP "CSV injection").
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvField(value: string): string {
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
