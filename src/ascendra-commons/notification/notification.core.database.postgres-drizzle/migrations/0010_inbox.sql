-- notification · the in-app inbox — what the `in_app` channel delivers.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/inbox.schema.ts`.
--
-- 2026-10-25 review: every channel left the app (email, SMS, WhatsApp) — nothing reached a user inside it. The
-- `in_app` channel renders its template into a row here; the user reads and marks their own through the inbox
-- endpoints. PostgresNotificationRetentionService.pruneInbox deletes old items.

CREATE TABLE IF NOT EXISTS "commons_notification_inbox" (
  "id"                bigserial   PRIMARY KEY,
  "application"       text        NOT NULL,
  "tenant_id"         text,
  "user_id"           text        NOT NULL,
  "notification_type" text        NOT NULL,
  "title"             text,
  "body"              text        NOT NULL,
  "correlation_id"    text,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "read_at"           timestamptz
);

-- A user's inbox newest-first (keyset on created_at, id).
CREATE INDEX IF NOT EXISTS "commons_notification_inbox_user_idx"
  ON "commons_notification_inbox" ("application", "user_id", "created_at" DESC, "id" DESC);

-- The unread badge and "unread only". Partial: read items stay out, and most are read.
CREATE INDEX IF NOT EXISTS "commons_notification_inbox_unread_idx"
  ON "commons_notification_inbox" ("application", "user_id", "created_at" DESC, "id" DESC)
  WHERE "read_at" IS NULL;

-- pruneInbox's "older than".
CREATE INDEX IF NOT EXISTS "commons_notification_inbox_created_idx"
  ON "commons_notification_inbox" ("application", "created_at");
