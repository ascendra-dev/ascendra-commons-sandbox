import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';

/**
 * A per-request memo for permission lookups. Rendering one list endpoint can
 * call `can()` / `computeActionAvailability` dozens of times for the same
 * actor — without this, the database-backed authorizer would run the same
 * query dozens of times per request. With it, the first lookup queries and
 * every later one in that request is a Map hit.
 *
 * `AsyncLocalStorage`, not a request-scoped NestJS provider — the same choice
 * (and reasoning) as audit-logging's correlation context: a request-scoped
 * provider is "contagious" (anything injecting it becomes request-scoped too),
 * `AsyncLocalStorage` follows the async call chain without touching the DI
 * graph, and the authorizer stays a singleton.
 *
 * Nothing is shared across requests or across processes — the Map is created
 * fresh per request and discarded when it ends. So a permission change is
 * visible on the actor's very next request; there is no staleness and no
 * cross-node invalidation to worry about.
 *
 * Degrades safely: if `AuthorizationCacheMiddleware` isn't wired, there is no
 * ambient store and every lookup just queries (correct, only slower). It is
 * stack-agnostic — it lives here in the family package, not in a stack adapter.
 */
const store = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Run `fn` with a fresh per-request permission cache in scope. */
export function runWithPermissionCache<T>(fn: () => T): T {
  return store.run(new Map(), fn);
}

/**
 * Return the cached value for `key`, or compute it with `load` and cache the
 * in-flight promise (so concurrent lookups for the same key share one query).
 * With no ambient cache, just calls `load`.
 */
export function memoizePermissionLookup<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cache = store.getStore();
  if (!cache) return load();
  const existing = cache.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = load();
  cache.set(key, pending);
  return pending;
}

/**
 * Wire this once, globally, ahead of any route that checks permissions:
 * `consumer.apply(AuthorizationCacheMiddleware).forRoutes('*')`. Optional but
 * recommended when using the database-backed authorizer.
 */
@Injectable()
export class AuthorizationCacheMiddleware implements NestMiddleware {
  use(_req: unknown, _res: unknown, next: (error?: unknown) => void): void {
    runWithPermissionCache(next);
  }
}
