import type { UserContactResolver } from '../../notification.core';

/** The cap on lookups when the resolver has no `findByIds` — a page of deliveries, never more. */
const MAX_ONE_BY_ONE = 200;

/**
 * Names for the user recipients on a page — `user:<id>` refs (or keys) → the resolver's `name`. A guest (`raw:…`, a
 * hashed address) has none: its address is never stored. No resolver, no name: the console shows the id.
 */
export async function recipientNames(
  resolver: UserContactResolver | null | undefined,
  refs: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [...new Set(refs.filter((r): r is string => !!r && r.startsWith('user:')).map((r) => r.slice('user:'.length)))];
  const names = new Map<string, string>();
  if (!resolver || ids.length === 0) return names;
  try {
    if (resolver.findByIds) {
      for (const user of await resolver.findByIds(ids)) if (user.name) names.set(`user:${user.id}`, user.name);
    } else {
      const found = await Promise.all(ids.slice(0, MAX_ONE_BY_ONE).map(async (id) => [id, await resolver.findById(id)] as const));
      for (const [id, user] of found) if (user?.name) names.set(`user:${id}`, user.name);
    }
  } catch {
    // A name is a nicety — a failing directory leaves the ids showing, never fails the read.
  }
  return names;
}
