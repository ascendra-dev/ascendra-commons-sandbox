-- notification · delivery log — a searchable recipient key.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/delivery.schema.ts`.
--
-- 2026-10-25 review: a guest (raw) recipient was logged only as `raw:email`, so "everything we sent to this payer"
-- couldn't be answered. `recipient_key` is `user:<id>`, or a keyed hash (HMAC, the app's `recipientHashKey`) of the
-- address the channel used — searchable, and what a suppression is filed under, without storing the address. NULL
-- where the app hashes nothing; older rows stay NULL.

ALTER TABLE "commons_notification_delivery" ADD COLUMN IF NOT EXISTS "recipient_key" text;

-- The log filtered to one recipient (a user, or a hashed address). Partial: rows without a key stay out.
-- A plain CREATE INDEX blocks writes while it builds — on a large table, build it first with CREATE INDEX CONCURRENTLY.
CREATE INDEX IF NOT EXISTS "commons_notification_delivery_recipient_key_idx"
  ON "commons_notification_delivery" ("application", "recipient_key", "attempted_at" DESC, "id" DESC)
  WHERE "recipient_key" IS NOT NULL;
