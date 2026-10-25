import type { NotificationResult } from './notification.types';

/** `claim`'s answer — this call sends, or another already did (its result, or `null` while it's still sending). */
export type DedupeClaim = { claimed: true } | { claimed: false; prior: NotificationResult | null };

/**
 * Makes `notify({ dedupeKey })` send once per key within a window — a job retried after a crash, a webhook delivered
 * twice, a double-click: the second call sends nothing and gets the first one's result. Optional: bound via
 * `NotificationModule.forRoot({ deduplicatorToken, dedupeWindowMs })`; without it, `dedupeKey` is ignored.
 *
 * `claim` is atomic — two concurrent calls with one key: exactly one is `claimed`. A claim whose window has passed
 * can be taken again.
 */
export interface NotificationDeduplicator {
  claim(key: string, windowMs: number): Promise<DedupeClaim>;
  /** Stores the claimed call's result — what a later duplicate gets back. */
  complete(key: string, result: NotificationResult): Promise<void>;
}
