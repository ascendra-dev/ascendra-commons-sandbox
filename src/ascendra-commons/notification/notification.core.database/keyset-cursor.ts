/**
 * Opaque keyset-pagination cursor for the delivery log: base64url of the JSON `[timestamp, id]` — JSON, not a
 * delimited string, so no part can smuggle the delimiter. The timestamp is the row's `attempted_at` at the column's
 * own precision (microseconds — a JS `Date` keeps milliseconds, and page 2 would skip rows); the id is the
 * `bigserial` tie-break. Stack-agnostic — a MySQL adapter reuses it verbatim. Duplicated from `background-jobs.core`
 * so the module stays copyable.
 */

/** A cursor this reader never issued — the `.api` answers 400 rather than silently restarting at page one. */
export class InvalidDeliveryCursorError extends Error {
  override readonly name = 'InvalidDeliveryCursorError';
}

export function encodeKeysetCursor(timestamp: string, id: string): string {
  return Buffer.from(JSON.stringify([timestamp, id])).toString('base64url');
}

/** Null unless it decodes to an ISO date-time and a delivery id. */
export function decodeKeysetCursor(cursor: string): { timestamp: string; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [timestamp, id] = parsed as unknown[];
    if (typeof timestamp !== 'string' || typeof id !== 'string') return null;
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(timestamp) || Number.isNaN(Date.parse(timestamp))) return null;
    if (!isDeliveryId(id)) return null;
    return { timestamp, id };
  } catch {
    return null;
  }
}

/** A `bigserial` id as text — digits only, within bigint. Anything else can't name a delivery (and `::bigint` would 500). */
export function isDeliveryId(id: string): boolean {
  return /^\d{1,19}$/.test(id) && BigInt(id) <= 9_223_372_036_854_775_807n;
}
