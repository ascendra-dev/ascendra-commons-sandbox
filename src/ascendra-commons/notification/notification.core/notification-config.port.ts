import { NotificationChannel } from './notification.types';
import { NotificationTemplate } from './notification-template';

/**
 * Delivery credentials/settings for one channel, for one tenant — an **opaque
 * JSON object**. This library never reads inside it: the shape varies by
 * provider (a single API key; an access key + secret + region; an OAuth token;
 * an account SID + auth token + from-number) and can't be anticipated. The
 * consumer's real `send()` implementation interprets it. The Postgres adapter
 * stores it as one `jsonb` column.
 *
 * Must be JSON-serialisable — it round-trips through `jsonb`.
 */
export type ProviderConfig = Record<string, unknown>;

/**
 * The one configuration surface a consumer supplies: channel routing,
 * per-channel templates, per-channel delivery credentials. One interface, one
 * token (`NOTIFICATION_CONFIG`).
 *
 * `tenantId` is `request.tenantId ?? null` — always passed, never optional, so
 * every implementation consciously receives tenant context rather than
 * silently ignoring it by omission. Model 1 (`StaticNotificationConfig`,
 * `notification.core.static`) ignores it for `channelsFor`/`templateFor` and
 * honors it for `providerConfigFor`; Model 2 (`notification.core.database`)
 * resolves a tenant-specific row first, falling through to the deployment
 * default.
 *
 * `channelsFor` returns which channels a notificationType uses; `templateFor`
 * and `providerConfigFor` take the channel as a parameter (the calling sender
 * always knows its own).
 */
export interface NotificationConfig {
  channelsFor(notificationType: string, tenantId: string | null): Promise<NotificationChannel[]>;
  templateFor(
    channel: NotificationChannel,
    notificationType: string,
    tenantId: string | null,
  ): Promise<NotificationTemplate | null>;
  /**
   * The tenant's own account; for `tenantId` null, the platform's. A tenant with none gets `null` — or, where the
   * implementation is configured to fall back, the platform's. Never another tenant's.
   */
  providerConfigFor(channel: NotificationChannel, tenantId: string | null): Promise<ProviderConfig | null>;
}

/**
 * The in-memory data `StaticNotificationConfig` reads, and the shape
 * `seedNotificationConfigFromData` seeds from. Only `channels` is required.
 */
export interface NotificationConfigData {
  /** notificationType -> channel(s). An unconfigured type resolves to zero channels — fails closed. */
  channels: Record<string, NotificationChannel[]>;
  /** channel -> (notificationType -> template). A missing entry is a per-send `template_not_found`. */
  templates?: Partial<Record<NotificationChannel, Record<string, NotificationTemplate>>>;
  /** channel -> (tenantId -> credentials). A missing entry is a per-send `no_provider_config`. */
  providerConfigs?: Partial<Record<NotificationChannel, Record<string, ProviderConfig>>>;
  /** channel -> the platform's own account — what a tenantless send uses (and, with `tenantCredentialFallback`, a tenant without one). */
  platformProviderConfigs?: Partial<Record<NotificationChannel, ProviderConfig>>;
}
