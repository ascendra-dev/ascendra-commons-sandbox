-- notification · delivery log — find a delivery's retry.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/delivery.schema.ts`.
--
-- 2026-10-26 console: a failed delivery shows that it was retried, and links to the retry — every delivery read looks
-- up `retry_of = id`. Partial: only retries carry it.

CREATE INDEX IF NOT EXISTS "commons_notification_delivery_retry_of_idx"
  ON "commons_notification_delivery" ("application", "retry_of")
  WHERE "retry_of" IS NOT NULL;
