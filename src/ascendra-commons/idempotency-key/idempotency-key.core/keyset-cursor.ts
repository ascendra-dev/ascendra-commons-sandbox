/**
 * Opaque keyset-pagination cursor: base64url of `<ISO timestamp>|<key>|<scope>`.
 * `listClaims()` keysets on `(created_at, key, scope)` — the primary key is the
 * `(key, scope)` pair, not a single id, so the cursor carries both. Stack-agnostic
 * — reused verbatim by any adapter, which is why it lives in `.core` (the same
 * reasoning every other module's copy of this helper is duplicated for, not
 * shared, so each module stays independently copyable).
 */

/** A `cursor` this module never issued — a stack adapter throws it, `idempotency-key.api` answers 400. */
export class InvalidIdempotencyCursorError extends Error {
  override readonly name = 'InvalidIdempotencyCursorError';
}

export function encodeKeysetCursor(timestamp: Date, key: string, scope: string): string {
  return Buffer.from(`${timestamp.toISOString()}|${key}|${scope}`).toString('base64url');
}

export function decodeKeysetCursor(cursor: string): { timestamp: Date; key: string; scope: string } | null {
  try {
    const [ts, key, scope] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!ts || !key || !scope || Number.isNaN(Date.parse(ts))) return null;
    return { timestamp: new Date(ts), key, scope };
  } catch {
    return null;
  }
}
