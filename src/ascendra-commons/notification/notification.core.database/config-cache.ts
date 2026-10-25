/**
 * A tiny time-based memo. Notification config (routing, templates, credentials)
 * changes rarely, but `Notifier.notify()` + each sender read it on every send —
 * a batch job doing hundreds of notifications would otherwise fire hundreds of
 * identical queries. A short TTL collapses that with a bounded staleness
 * window; a change is visible after at most `ttlMs`.
 *
 * Per-process, not shared (no Redis) — same posture as the authorization
 * family's per-request cache, just time-bounded rather than request-bounded
 * because a batch job has no request. `ttlMs <= 0` disables it entirely.
 *
 * Stack-agnostic — it lives here in the family package, so a MySQL (or any
 * other) `NotificationConfig` adapter reuses it rather than re-implementing.
 *
 * An edit through the admin API calls `ConfigCache.invalidateAll()`, so this process sends with the new route or
 * template at once — an admin who saves a template and test-sends gets the new text. Another instance of the app
 * still serves its cached copy until the TTL runs out.
 */
export class ConfigCache {
  /** Every cache in this process — what `invalidateAll` empties. */
  private static readonly instances = new Set<ConfigCache>();

  /** Empties every config cache in this process — called after a config write. */
  static invalidateAll(): void {
    for (const cache of ConfigCache.instances) cache.clear();
  }

  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
  ) {
    ConfigCache.instances.add(this);
  }

  clear(): void {
    this.entries.clear();
  }

  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (this.ttlMs <= 0) return load();

    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;

    const value = await load();
    if (this.entries.size >= this.maxEntries) this.evictExpired();
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    // Still full of live entries? Drop the oldest-inserted to stay bounded.
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}
