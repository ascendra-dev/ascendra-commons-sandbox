import { boolean, index, jsonb, pgTable, text, unique } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_notification_*` schema — one concrete Postgres/Drizzle shape
 * of the `NotificationConfig` interface (Model 2). Source of truth for the
 * columns — a change ships as the next numbered file in `../migrations/` (never
 * an edit to a released one).
 *
 * Three tables, one per `NotificationConfig` method. Import them where you
 * query them, but never re-export them into the schema files `drizzle-kit`
 * reads — the DDL comes from `../migrations/`. Requires PostgreSQL 15+
 * (NULLS NOT DISTINCT).
 *
 * Every row carries `application` (which Ascendra app it belongs to), and every
 * read filters by it — so these tables stay correct whether each app keeps its
 * own database (the common case, one constant value) or they are ever
 * consolidated into one shared config database (rows disambiguated). Stamped
 * from `PostgresNotificationConfigModule.forRoot({ application })`.
 */

/**
 * Which channel(s) a notificationType uses. `tenant_id` NULL = the deployment
 * default; a tenant-specific row (if present) wins over it.
 */
export const notificationChannelRoute = pgTable(
  'commons_notification_channel_route',
  {
    application: text('application').notNull(),
    notificationType: text('notification_type').notNull(),
    tenantId: text('tenant_id'),
    channels: text('channels').array().notNull(),
  },
  (t) => [
    unique('commons_notification_channel_route_uq').on(t.application, t.notificationType, t.tenantId).nullsNotDistinct(),
  ],
);

/**
 * Template text for one channel + notificationType. `tenant_id` NULL = the
 * deployment default; a tenant-specific row wins. `subject`/`is_html` are
 * email-only — SMS rows leave `subject` null.
 */
export const notificationTemplate = pgTable(
  'commons_notification_template',
  {
    application: text('application').notNull(),
    channel: text('channel').notNull(),
    notificationType: text('notification_type').notNull(),
    tenantId: text('tenant_id'),
    subject: text('subject'),
    body: text('body').notNull(),
    isHtml: boolean('is_html').notNull().default(false),
  },
  (t) => [
    unique('commons_notification_template_uq')
      .on(t.application, t.channel, t.notificationType, t.tenantId)
      .nullsNotDistinct(),
  ],
);

/**
 * Delivery-provider settings for one channel: a tenant's own account, or — `tenant_id` NULL — the platform's.
 * A tenantless send uses the platform's; a tenant with no row of its own fails `no_provider_config`, unless the app
 * turns `tenantCredentialFallback` on, when it sends through the platform's. Never another tenant's account.
 *
 * `config` is one opaque `jsonb` blob — the adapter returns it verbatim as
 * `ProviderConfig`, because provider credential shapes vary and can't be
 * anticipated (a single API key; access key + secret + region; an OAuth token;
 * SID + auth token + number). The consumer's real `send()` interprets it.
 *
 * It typically holds live secrets — encrypt at rest (Supabase Vault, `pgcrypto`,
 * a decrypting view), or store secret-manager references in the JSON and
 * resolve them in a `PostgresNotificationConfig` subclass.
 */
export const notificationProviderCredential = pgTable(
  'commons_notification_provider_credential',
  {
    application: text('application').notNull(),
    channel: text('channel').notNull(),
    tenantId: text('tenant_id'),
    config: jsonb('config').notNull().$type<Record<string, unknown>>(),
  },
  (t) => [
    unique('commons_notification_provider_credential_uq').on(t.application, t.channel, t.tenantId).nullsNotDistinct(),
    index('commons_notification_provider_credential_tenant').on(t.application, t.tenantId),
  ],
);
