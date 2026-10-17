import { describe, expect, it } from 'vitest';
import { streamAuditEventsCsv } from './audit-events-csv';
import type { AuditEvent } from '../audit-logging.core';

function event(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'ae-1',
    entityType: 'invoice',
    entityId: 'inv-1',
    tenantId: 't-1',
    actor: 'u-1',
    action: 'status_changed',
    before: { status: 'sent' },
    after: { status: 'paid' },
    correlationId: 'trace-1',
    reason: null,
    application: 'ascendra-pay',
    occurredAt: new Date('2026-09-07T09:41:02.481Z'),
    ...over,
  };
}

async function* pagesOf(...pages: AuditEvent[][]) {
  yield* pages;
}

async function renderAuditEventsCsv(...pages: AuditEvent[][]): Promise<string> {
  let csv = '';
  for await (const chunk of streamAuditEventsCsv(pagesOf(...pages))) csv += chunk;
  return csv;
}

describe('streamAuditEventsCsv', () => {
  it('emits a header row and one line per record', async () => {
    const csv = await renderAuditEventsCsv([event()]);
    const lines = csv.trim().split('\r\n');

    expect(lines[0]).toBe('id,occurredAt,entityType,entityId,tenantId,actor,action,before,after,correlationId,reason,application');
    expect(lines[1]).toBe(
      'ae-1,2026-09-07T09:41:02.481Z,invoice,inv-1,t-1,u-1,status_changed,"{""status"":""sent""}","{""status"":""paid""}",trace-1,,ascendra-pay',
    );
  });

  it('renders only the header row for an empty result set', async () => {
    expect(await renderAuditEventsCsv([])).toBe('id,occurredAt,entityType,entityId,tenantId,actor,action,before,after,correlationId,reason,application\r\n');
  });

  it('renders null tenantId and reason as empty fields', async () => {
    const csv = await renderAuditEventsCsv([event({ tenantId: null, reason: null, before: null, after: null })]);
    const [, dataLine] = csv.trim().split('\r\n');
    expect(dataLine).toBe('ae-1,2026-09-07T09:41:02.481Z,invoice,inv-1,,u-1,status_changed,,,trace-1,,ascendra-pay');
  });

  it('quotes and escapes a field containing a comma or double quote', async () => {
    const csv = await renderAuditEventsCsv([event({ reason: 'Marked "paid", after reconciliation' })]);
    expect(csv).toContain('"Marked ""paid"", after reconciliation"');
  });

  it('emits one header row across several pages', async () => {
    const csv = await renderAuditEventsCsv([event({ id: 'a' })], [], [event({ id: 'b' }), event({ id: 'c' })]);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.split(',')[0])).toEqual(['id', 'a', 'b', 'c']);
  });
});
