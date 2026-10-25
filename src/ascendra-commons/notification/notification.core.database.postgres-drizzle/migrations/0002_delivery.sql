-- notification · delivery log (PostgresNotificationDeliveryRecorder +
-- PostgresNotificationObservabilityService).
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/delivery.schema.ts` and the INSERT in
-- `delivery-log/postgres-notification-delivery-recorder.ts` — change them together.
--
-- `recipient_ref` is redacted (`user:<id>` / `raw:email` / `raw:phone` / `raw`) —
-- never an address. `status` is 'sent' / 'failed' at send time; a provider
-- webhook may later move it to 'delivered' / 'bounced'. `application` scopes
-- every read.

CREATE TABLE IF NOT EXISTS "commons_notification_delivery" (
  "id"                  bigserial   PRIMARY KEY,
  "application"         text        NOT NULL,
  "notification_type"   text        NOT NULL,
  "channel"             text        NOT NULL,
  "tenant_id"           text,
  "recipient_ref"       text        NOT NULL,
  "status"              text        NOT NULL,
  "reason"              text,
  "provider_message_id" text,
  "attempted_at"        timestamptz NOT NULL,
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  "correlation_id"      text,
  -- rendered message + variables; written only when the recorder is `storeContent: true`. PII-bearing.
  "content"             jsonb
);

CREATE INDEX IF NOT EXISTS "commons_notification_delivery_type_time_idx"
  ON "commons_notification_delivery" ("application", "notification_type", "attempted_at");

CREATE INDEX IF NOT EXISTS "commons_notification_delivery_recipient_idx"
  ON "commons_notification_delivery" ("application", "recipient_ref", "attempted_at");

CREATE INDEX IF NOT EXISTS "commons_notification_delivery_provider_msg_idx"
  ON "commons_notification_delivery" ("provider_message_id");
