import type { DeliveryContent, NotificationChannel } from '../notification.core';

/**
 * The answer-shapes for the notification admin/observability surface — what
 * every stack adapter returns and `notification.api` serves. Stack-agnostic
 * (no SQL, no ORM types). Moved here from the Postgres adapter so a second
 * stack adapter shares them.
 */

/** One `commons_notification_delivery` row, typed for a UI. */
export interface DeliveryRecord {
  id: string;
  notificationType: string;
  channel: NotificationChannel;
  tenantId: string | null;
  recipientRef: string;
  /** `user:<id>` or a keyed hash of the address — what the log searches by; `null` when the app hashes nothing. */
  recipientKey: string | null;
  /** `skipped` — deliberately not sent (suppressed, opted out); `reason` says which. */
  status: 'sent' | 'failed' | 'delivered' | 'bounced' | 'skipped';
  reason: string | null;
  providerMessageId: string | null;
  attemptedAt: Date;
  updatedAt: Date;
  correlationId: string | null;
  /** Whether the rendered `content` was stored for this row (the recorder's `storeContent`). */
  hasContent: boolean;
  /** A verification send (test send) — left out of the stats. */
  isTest: boolean;
  /** The delivery this one retries — `null` for a first send. */
  retryOf: string | null;
}

/** One row's stored rendered content — from `getDeliveryContent(id)`, null when not stored. */
export interface DeliveryContentRecord {
  id: string;
  notificationType: string;
  channel: NotificationChannel;
  recipientRef: string;
  attemptedAt: Date;
  content: DeliveryContent;
}

export interface DeliveryHistoryQuery {
  notificationType?: string;
  channel?: NotificationChannel;
  tenantId?: string;
  /** e.g. `'user:abc123'`. */
  recipientRef?: string;
  /** `user:<id>` or a hashed address — `notification.api` hashes a searched address into this. */
  recipientKey?: string;
  status?: DeliveryRecord['status'];
  /** Join to the same id in audit / job-run history for a cross-module trace. */
  correlationId?: string;
  /** `true` = test sends only, `false` = real sends only; omitted = both. */
  test?: boolean;
  since?: Date;
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  cursor?: string;
}

export interface DeliveryHistoryPage {
  deliveries: DeliveryRecord[];
  nextCursor?: string;
}

export interface DeliveryStatsQuery {
  tenantId?: string;
  /**
   * Whole calendar days in `timeZone`, ending today — the window starts at the first day's local midnight. Takes
   * precedence over `since`. (A per-day chart over a rolling window would show a partial first day.)
   */
  days?: number;
  /** Inclusive start of a rolling window (e.g. the last 24 hours). Defaults to 7 days before `until`. */
  since?: Date;
  /** Exclusive end of the window. Defaults to now. */
  until?: Date;
  /** IANA zone the days are counted in — `byDay` buckets by local date. Default `'UTC'`. */
  timeZone?: string;
}

export interface DeliveryChannelStatusCount {
  channel: NotificationChannel;
  status: DeliveryRecord['status'];
  count: number;
}

export interface DeliveryTypeStatusCount {
  notificationType: string;
  status: DeliveryRecord['status'];
  count: number;
}

export interface DeliveryDayCount {
  /** Calendar day in the query's time zone, `YYYY-MM-DD`. */
  day: string;
  count: number;
}

/**
 * Sends that didn't reach anyone, by why — the reason's code (`provider_auth_failed`, not the provider's full text), or
 * `bounced` for a provider's bounce.
 */
export interface DeliveryReasonCount {
  status: 'failed' | 'skipped' | 'bounced';
  reason: string;
  count: number;
}

/** One calendar day of the Volume & Retention chart. */
export interface DeliveryVolumeDay {
  /** `YYYY-MM-DD` in the requested time zone. */
  day: string;
  deliveries: number;
  failed: number;
  /** Rows still holding their stored message — what `clearContent` empties. */
  withContent: number;
}

/** Per-day deliveries over 30 calendar days, and the table's extent — the Volume & Retention screen. */
export interface DeliveryVolume {
  oldestAttemptedAt: Date | null;
  rowCount: number;
  /** Rows holding stored content, and the oldest of them — what the content retention has left. */
  contentRowCount: number;
  oldestContentAt: Date | null;
  /** `pg_total_relation_size` — the whole table, every application in it; `null` where the store can't say. */
  tableSizeBytes: number | null;
  perDay: DeliveryVolumeDay[];
}

/** `GET /notifications/stats` — send volume grouped a few ways over one window. */
export interface DeliveryStats {
  since: Date;
  until: Date;
  byChannel: DeliveryChannelStatusCount[];
  byType: DeliveryTypeStatusCount[];
  byDay: DeliveryDayCount[];
  /** Failed, skipped and bounced sends by reason — most first. */
  byReason: DeliveryReasonCount[];
}

/** A hole in the routing/template/credential config, for a "config health" panel. */
export interface CoverageGap {
  notificationType: string;
  tenantId: string | null;
  channel: NotificationChannel;
  kind: 'missing_template' | 'missing_provider_credential';
}

/**
 * Whose configuration a read covers: `{ tenantId }` = the deployment defaults (`tenant_id` NULL) plus that tenant's own
 * rows — what a tenant admin may see; omitted = every row (a platform admin). Credentials have no default rows to show.
 */
export interface ConfigScope {
  tenantId: string;
}

export interface ChannelRouteView {
  notificationType: string;
  tenantId: string | null;
  channels: NotificationChannel[];
}

export interface TemplateView {
  channel: NotificationChannel;
  notificationType: string;
  tenantId: string | null;
  subject: string | null;
  body: string;
  isHtml: boolean;
}

/** Credentials are never returned — only which (channel, tenant) pairs have one. `tenantId` null = the platform's. */
export interface ProviderCredentialView {
  channel: NotificationChannel;
  tenantId: string | null;
}

/** One suppression-list entry — a recipient a channel stopped sending to. */
export interface SuppressionView {
  id: string;
  channel: NotificationChannel;
  /** `user:<id>` or the keyed hash of an address — the delivery log filters by it. */
  recipientKey: string;
  tenantId: string | null;
  /** The provider's word: `bounced`, `complained`, `failed`. */
  reason: string;
  detail: string | null;
  firstAt: Date;
  lastAt: Date;
  eventCount: number;
}

export interface SuppressionListQuery {
  /** Default 50, capped at 200. */
  limit?: number;
  cursor?: string;
}

export interface SuppressionPage {
  suppressions: SuppressionView[];
  nextCursor?: string;
}

// ---- write inputs ----

export interface SetChannelRouteInput {
  notificationType: string;
  tenantId: string | null;
  channels: NotificationChannel[];
}

export interface DeleteChannelRouteInput {
  notificationType: string;
  tenantId: string | null;
}

export interface SetTemplateInput {
  channel: NotificationChannel;
  notificationType: string;
  tenantId: string | null;
  subject?: string | null;
  body: string;
  isHtml?: boolean;
}

export interface DeleteTemplateInput {
  channel: NotificationChannel;
  notificationType: string;
  tenantId: string | null;
}

export interface SetProviderCredentialInput {
  channel: NotificationChannel;
  /** `null` = the platform's own account. */
  tenantId: string | null;
  config: Record<string, unknown>;
}

export interface DeleteProviderCredentialInput {
  channel: NotificationChannel;
  tenantId: string | null;
}
