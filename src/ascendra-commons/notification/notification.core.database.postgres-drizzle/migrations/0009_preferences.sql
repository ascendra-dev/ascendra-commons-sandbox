-- notification · a user's own preferences — opt-outs per type and channel.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/preference.schema.ts`.
--
-- 2026-10-25 review: a user couldn't turn anything off — every routed channel of every type reached them, a
-- marketing-style reminder as surely as a password reset. A row is one rule: a type (or '*', every type) on a channel
-- (or '*', every channel), enabled or not; the most specific rule matching a send wins. Notifier skips an opted-out
-- channel unless the type is declared `required`. No row: sent.

CREATE TABLE IF NOT EXISTS "commons_notification_preference" (
  "application"       text        NOT NULL,
  "user_id"           text        NOT NULL,
  "notification_type" text        NOT NULL,
  "channel"           text        NOT NULL,
  "enabled"           boolean     NOT NULL,
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("application", "user_id", "notification_type", "channel")
);
