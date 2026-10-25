import type { NotificationChannel } from './notification.types';

/**
 * The full-fidelity rendered message plus the variables that produced it —
 * PII-bearing. Written to `commons_notification_delivery.content` (a nullable
 * `jsonb`) **only when the recorder is configured with `storeContent: true`**.
 * The "light" message archive: kept in the same row, pruned with the same
 * retention. For a long-retention / legal archive, use `file-storage` instead.
 */
export interface DeliveryContent {
  subject: string | null;
  body: string;
  isHtml: boolean;
  variables: Record<string, string | number>;
}

/**
 * One channel's send attempt, as `Notifier` observed it — one row in the
 * delivery log. `recipientRef` is deliberately *redacted*: `user:<id>` for a
 * known user, or just `raw:email` / `raw:phone` / `raw` for a raw recipient —
 * never the actual address, so the log isn't a PII store.
 */
export interface DeliveryAttempt {
  notificationType: string;
  channel: NotificationChannel;
  tenantId: string | null;
  recipientRef: string;
  /**
   * What the log searches by and a suppression is filed under: `user:<id>`, or a keyed hash of a raw recipient's
   * address on this channel — `null` when the app hashes nothing (no `recipientHashKey`).
   */
  recipientKey?: string | null;
  status: 'sent' | 'failed' | 'skipped';
  reason?: string;
  providerMessageId?: string;
  attemptedAt: Date;
  /** The ambient correlation id, when the consumer threads one in. */
  correlationId?: string;
  /** A verification send — recorded, but left out of the stats. */
  test?: boolean;
  /** The delivery this attempt retries. */
  retryOf?: string;
  /**
   * The rendered message (from the sender) + the request variables. Carried
   * whenever the sender rendered a template; the recorder persists it only
   * when `storeContent: true`, else the `content` column stays NULL.
   */
  content?: DeliveryContent;
}

/** A later status change for a row, matched by `providerMessageId` — fed from a provider webhook. */
export interface DeliveryStatusUpdate {
  providerMessageId: string;
  status: 'delivered' | 'bounced' | 'failed';
  /** Bounce reason / provider detail. */
  detail?: string;
  /**
   * A hard bounce or a complaint — stop sending to this recipient on this channel: the recorder files the delivery's
   * recipient key in the suppression list (where the store has one). A soft bounce leaves it `false`.
   */
  suppress?: boolean;
}

/**
 * The delivery-log port. `Notifier` calls `recordAttempts()` once per
 * `notify()` (one entry per channel). **Best-effort by contract: an
 * implementation must not throw** — a failure to log a delivery must never
 * change the notification's own outcome. `Notifier` also guards the call.
 *
 * `updateDeliveryStatus()` is the webhook side — the consumer's provider-webhook
 * controller calls it. `NoopNotificationDeliveryRecorder` (this package) makes
 * both inert; `notification.core.database.postgres-drizzle` implements them
 * against `commons_notification_delivery`.
 */
export interface NotificationDeliveryRecorder {
  recordAttempts(attempts: DeliveryAttempt[]): Promise<void>;
  updateDeliveryStatus(update: DeliveryStatusUpdate): Promise<void>;
}
