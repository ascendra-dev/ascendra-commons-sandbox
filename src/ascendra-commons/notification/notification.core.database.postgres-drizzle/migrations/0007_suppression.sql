-- notification · the suppression list — recipients a channel stops sending to.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/suppression.schema.ts`. Requires PostgreSQL 15+.
--
-- 2026-10-25 review: a bounce was recorded on its delivery row and nowhere else — the next send went to the same dead
-- address, and the one after, wearing down the sender's reputation with the provider. A provider webhook reporting a
-- hard bounce or a complaint (`updateDeliveryStatus({ suppress: true })`) files the delivery's recipient key here;
-- Notifier skips that channel for that recipient until an admin removes the entry. Keyed like the delivery log —
-- `user:<id>` or the keyed hash of an address, never the address.

CREATE TABLE IF NOT EXISTS "commons_notification_suppression" (
  "id"            bigserial   PRIMARY KEY,
  "application"   text        NOT NULL,
  "channel"       text        NOT NULL,
  "recipient_key" text        NOT NULL,
  -- the tenant of the delivery that bounced — whose admin sees it; NULL for a tenantless send
  "tenant_id"     text,
  -- 'bounced' / 'complained' / 'failed' — the provider's word for it
  "reason"        text        NOT NULL,
  "detail"        text,
  "first_at"      timestamptz NOT NULL DEFAULT now(),
  "last_at"       timestamptz NOT NULL DEFAULT now(),
  "event_count"   integer     NOT NULL DEFAULT 1,
  CONSTRAINT "commons_notification_suppression_uq" UNIQUE ("application", "channel", "recipient_key")
);

-- The list newest-first (keyset on last_at, id), and a tenant admin's.
CREATE INDEX IF NOT EXISTS "commons_notification_suppression_list_idx"
  ON "commons_notification_suppression" ("application", "last_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "commons_notification_suppression_tenant_idx"
  ON "commons_notification_suppression" ("application", "tenant_id", "last_at" DESC, "id" DESC);
