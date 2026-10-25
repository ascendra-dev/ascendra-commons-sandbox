-- notification · delivery log — a retry links to the delivery it retries.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/delivery.schema.ts`.
--
-- 2026-10-25 review: a failed delivery could only be tried again by crafting a test send by hand — which went to the
-- admin, not the customer, and wasn't linked to the failure. POST /notifications/deliveries/:id/retry resends it on
-- its channel; the new row's `retry_of` names the one it retries.

ALTER TABLE "commons_notification_delivery" ADD COLUMN IF NOT EXISTS "retry_of" bigint;
