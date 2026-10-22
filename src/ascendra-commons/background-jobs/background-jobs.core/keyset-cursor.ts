/**
 * Opaque keyset-pagination cursor: base64url of the JSON array `[timestamp, id]`.
 * The run-history read keysets on `(started_at, id)`; a stack adapter's
 * `JobObservabilityPort` encodes the last row of a page and decodes an incoming
 * cursor. Stack-agnostic — a MySQL (or any other) adapter reuses it verbatim,
 * which is why it lives in `.core` (duplicated, not shared, with every other
 * module's copy so each stays independently copyable).
 *
 * `timestamp` is an ISO 8601 string at the store's own precision — Postgres keeps
 * microseconds, a JS `Date` only milliseconds. The reference recorder writes
 * `started_at` from a `Date`, but a consumer's own recorder may not, and a
 * truncated boundary makes the next page skip rows. JSON, not a delimiter.
 */

/** A `cursor` this module never issued — a stack adapter throws it, `background-jobs.api` answers 400. */
export class InvalidJobRunCursorError extends Error {
  override readonly name = 'InvalidJobRunCursorError';
}

export function encodeKeysetCursor(timestamp: string, id: string): string {
  return Buffer.from(JSON.stringify([timestamp, id])).toString('base64url');
}

/** Null unless it decodes to an ISO date-time and a numeric (bigserial) id. */
export function decodeKeysetCursor(cursor: string): { timestamp: string; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [timestamp, id] = parsed as unknown[];
    if (typeof timestamp !== 'string' || typeof id !== 'string') return null;
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(timestamp) || Number.isNaN(Date.parse(timestamp))) return null;
    if (!isRunId(id)) return null;
    return { timestamp, id };
  } catch {
    return null;
  }
}

/** A `bigserial` id as text — digits only, within bigint. Anything else can't name a run (and `::bigint` would 500). */
export function isRunId(id: string): boolean {
  return /^\d{1,19}$/.test(id) && BigInt(id) <= 9_223_372_036_854_775_807n;
}
