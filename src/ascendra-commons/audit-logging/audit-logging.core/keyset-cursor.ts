/**
 * Opaque keyset-pagination cursor: base64url of `<ISO timestamp>|<id>`. The
 * audit-event read keysets on `(occurred_at, id)`; a stack adapter's
 * `AuditEventReader` encodes the last row of a page and decodes an incoming
 * cursor. Stack-agnostic — a MySQL (or any other) reader reuses it verbatim,
 * which is why it lives in `.core` rather than a stack adapter.
 */
export function encodeKeysetCursor(timestamp: Date, id: string): string {
  return Buffer.from(`${timestamp.toISOString()}|${id}`).toString('base64url');
}

export function decodeKeysetCursor(cursor: string): { timestamp: Date; id: string } | null {
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!ts || !id || Number.isNaN(Date.parse(ts))) return null;
    return { timestamp: new Date(ts), id };
  } catch {
    return null;
  }
}
