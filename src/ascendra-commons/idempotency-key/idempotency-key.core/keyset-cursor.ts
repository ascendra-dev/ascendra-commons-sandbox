/**
 * Opaque keyset-pagination cursor: base64url of the JSON array `[timestamp, key, scope]`.
 * `listClaims()` keysets on `(created_at, key, scope)` — the primary key is the
 * `(key, scope)` pair, not a single id, so the cursor carries both. Stack-agnostic
 * — reused verbatim by any adapter, which is why it lives in `.core` (the same
 * reasoning every other module's copy of this helper is duplicated for, not
 * shared, so each module stays independently copyable).
 *
 * `timestamp` is an ISO 8601 string at the store's own precision — Postgres keeps
 * microseconds, a JS `Date` only milliseconds, so a `Date` here would truncate the
 * boundary and the next page would skip the rows older than it within that
 * millisecond. JSON, not a delimiter: a key is whatever the client sent, `|` included.
 */

/** A `cursor` this module never issued — a stack adapter throws it, `idempotency-key.api` answers 400. */
export class InvalidIdempotencyCursorError extends Error {
  override readonly name = 'InvalidIdempotencyCursorError';
}

export function encodeKeysetCursor(timestamp: string, key: string, scope: string): string {
  return Buffer.from(JSON.stringify([timestamp, key, scope])).toString('base64url');
}

export function decodeKeysetCursor(cursor: string): { timestamp: string; key: string; scope: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    // A NUL can't reach Postgres `text` (an encoding error, a 500) — and no cursor issued here holds one.
    const isPart = (part: unknown) => typeof part === 'string' && part !== '' && !part.includes('\u0000');
    if (!Array.isArray(parsed) || parsed.length !== 3 || !parsed.every(isPart)) {
      return null;
    }
    const [timestamp, key, scope] = parsed as [string, string, string];
    if (Number.isNaN(Date.parse(timestamp))) return null;
    return { timestamp, key, scope };
  } catch {
    return null;
  }
}
