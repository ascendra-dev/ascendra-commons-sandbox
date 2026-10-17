/**
 * A field-level before/after diff for one audit record — pure, stack-agnostic
 * (no DB, no framework), so it lives in `.core` alongside `keyset-cursor.ts`.
 * Powers the Record Detail screen's diff view over `AuditEvent.before`/`.after`.
 *
 * Nested plain objects are flattened to dot paths, so a change deep inside one
 * is reported at its leaf (`address.street`), not as the whole object. Arrays
 * are compared as single values: an index-by-index diff turns one insertion
 * into a change at every later index. A key that itself contains a dot yields
 * an ambiguous path — accepted, since audit snapshots don't use such keys.
 *
 * A path present on only one side is treated as `null` on the other — the
 * jsonb columns don't distinguish "field absent" from "field explicitly null"
 * at this level, and neither does this diff.
 */
export interface FieldDiffEntry {
  /** Dot path of the changed leaf, e.g. `address.street`. */
  field: string;
  before: unknown;
  after: unknown;
}

export function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): FieldDiffEntry[] {
  const b = flattenPaths(before ?? {});
  const a = flattenPaths(after ?? {});
  const fields = [...new Set([...b.keys(), ...a.keys()])].sort();

  const diffs: FieldDiffEntry[] = [];
  for (const field of fields) {
    const beforeValue = b.get(field) ?? null;
    const afterValue = a.get(field) ?? null;
    if (!sameValue(beforeValue, afterValue)) {
      diffs.push({ field, before: beforeValue, after: afterValue });
    }
  }
  return diffs;
}

/**
 * Leaf values of `value` keyed by dot path, in key order. Recurses into plain
 * objects only; arrays, primitives and `null` are leaves. An empty object is a
 * leaf too, so it doesn't vanish from the diff.
 */
export function flattenPaths(value: Record<string, unknown>, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(child) && Object.keys(child).length > 0) {
      for (const [childPath, leaf] of flattenPaths(child, path)) out.set(childPath, leaf);
    } else {
      out.set(path, child);
    }
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameValue(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;
  return JSON.stringify(x) === JSON.stringify(y);
}
