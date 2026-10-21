/**
 * Opaque keyset-pagination cursor: base64url of `<ISO timestamp>|<id>`. The
 * rejection log keysets on `(window_start, id)`. Stack-agnostic — duplicated
 * (not shared) across this library's modules so each stays independently
 * copyable.
 */
/** A `cursor` this module never issued — a stack adapter throws it, `rate-limiting.api` answers 400. */
export class InvalidRateLimitCursorError extends Error {
  override readonly name = 'InvalidRateLimitCursorError';
}

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
