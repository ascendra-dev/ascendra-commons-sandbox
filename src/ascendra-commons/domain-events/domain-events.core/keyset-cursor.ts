/**
 * Opaque keyset-pagination cursor: base64url of `<ISO timestamp>|<id>`. The
 * delivery log keysets on `(occurred_at, id)`; a stack adapter's
 * `EventDeliveryObservabilityPort` encodes the last row of a page and decodes
 * an incoming cursor. Stack-agnostic — reused verbatim by any adapter, which is
 * why it lives in `.core` rather than a stack adapter (same reasoning as
 * `audit-logging.core`'s copy of this same helper — duplicated, not shared,
 * so each module stays independently copyable).
 *
 * `occurred_at` is written from a JS `Date` (`event.occurredAt`), so a `Date` keeps its full precision here; and neither
 * part is caller-chosen text, so the `|` can't appear inside one.
 */

/** A `cursor` this module never issued — a stack adapter throws it, `domain-events.api` answers 400. */
export class InvalidDeliveryCursorError extends Error {
  override readonly name = 'InvalidDeliveryCursorError';
}

export function encodeKeysetCursor(timestamp: Date, id: string): string {
  return Buffer.from(`${timestamp.toISOString()}|${id}`).toString('base64url');
}

/** Null unless it decodes to a date and a numeric (bigserial) id. */
export function decodeKeysetCursor(cursor: string): { timestamp: Date; id: string } | null {
  try {
    const [ts, id, extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!ts || !id || extra !== undefined || !/^\d{1,19}$/.test(id) || Number.isNaN(Date.parse(ts))) return null;
    return { timestamp: new Date(ts), id };
  } catch {
    return null;
  }
}
