-- notification · dedupe keys — a notification sent once per key.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/dedupe.schema.ts`.
--
-- 2026-10-25 review: a job retried after a crash, a webhook delivered twice, a double-click — each sent the
-- notification again. `notify({ dedupeKey })` claims the key here (an atomic insert); a second call within the window
-- finds it and returns the first call's stored result instead of sending. An expired claim can be taken again;
-- PostgresNotificationRetentionService.pruneDedupeKeys deletes them.

CREATE TABLE IF NOT EXISTS "commons_notification_dedupe" (
  "application" text        NOT NULL,
  "dedupe_key"  text        NOT NULL,
  "claimed_at"  timestamptz NOT NULL DEFAULT now(),
  "expires_at"  timestamptz NOT NULL,
  -- the claimed call's NotificationResult — NULL while it is still sending
  "result"      jsonb,
  PRIMARY KEY ("application", "dedupe_key")
);

-- pruneDedupeKeys' "expired before".
CREATE INDEX IF NOT EXISTS "commons_notification_dedupe_expires_idx"
  ON "commons_notification_dedupe" ("application", "expires_at");
