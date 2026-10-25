-- notification · delivery log — a verification send is marked.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/delivery.schema.ts`.
--
-- 2026-10-25 review: a test send (`POST /notifications/test-send`) was recorded like any other delivery, so an admin
-- checking a template moved the deliverability numbers. `is_test` marks it; the stats leave it out, the log can show
-- or hide it. Every existing row was a real send.

ALTER TABLE "commons_notification_delivery" ADD COLUMN IF NOT EXISTS "is_test" boolean NOT NULL DEFAULT false;
