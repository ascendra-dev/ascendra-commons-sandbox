-- notification · Postgres/Drizzle config tables (Model 2).
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The tables' current shape: `persistence/config.schema.ts`. Requires PostgreSQL 15+.
--
-- `application` = which Ascendra app the row belongs to. Constant within one
-- app's own database; the column and every read's `application = $1` filter
-- keep these tables correct if they are ever consolidated into one shared
-- config database. Stamped from PostgresNotificationConfigModule.forRoot({ application }).

CREATE TABLE IF NOT EXISTS "commons_notification_channel_route" (
  "application"       text NOT NULL,
  "notification_type" text NOT NULL,
  "tenant_id"         text,
  "channels"          text[] NOT NULL,
  CONSTRAINT "commons_notification_channel_route_uq"
    UNIQUE NULLS NOT DISTINCT ("application", "notification_type", "tenant_id")
);

CREATE TABLE IF NOT EXISTS "commons_notification_template" (
  "application"       text NOT NULL,
  "channel"           text NOT NULL,
  "notification_type" text NOT NULL,
  "tenant_id"         text,
  "subject"           text,
  "body"              text NOT NULL,
  "is_html"           boolean NOT NULL DEFAULT false,
  CONSTRAINT "commons_notification_template_uq"
    UNIQUE NULLS NOT DISTINCT ("application", "channel", "notification_type", "tenant_id")
);

CREATE TABLE IF NOT EXISTS "commons_notification_provider_credential" (
  "application" text  NOT NULL,
  "channel"     text  NOT NULL,
  "tenant_id"   text  NOT NULL,
  "config"      jsonb NOT NULL,
  PRIMARY KEY ("application", "channel", "tenant_id")
);

CREATE INDEX IF NOT EXISTS "commons_notification_provider_credential_tenant"
  ON "commons_notification_provider_credential" ("application", "tenant_id");

-- `config` is an opaque JSON blob whose shape varies by provider; it typically
-- holds live secrets. Encrypt it at rest — Supabase Vault, pgcrypto, a
-- decrypting view — or store secret-manager references in the JSON. Also
-- consider REVOKE select ON commons_notification_provider_credential from the ordinary
-- read role.
