-- notification · delivery log — indexes for the reads the notification screens make.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/delivery.schema.ts` — change them together.
--
-- 2026-10-25 review: the log newest-first keysets on (attempted_at, id), but no index led with attempted_at — the
-- list, its cursor, the stats and volume windows and the retention cutoffs sorted or scanned the application's rows.
-- The type and recipient indexes had no id, so a filtered page sorted every match. A tenant admin's list, the failed
-- filter and a correlation trace had no index at all.
--
-- A plain CREATE INDEX blocks writes while it builds — the recorder's inserts included. On a large table, build each
-- index first with CREATE INDEX CONCURRENTLY (outside a transaction, same name and columns); IF NOT EXISTS then makes
-- this file a no-op for it.

-- The log newest-first (keyset on attempted_at, id), the stats / volume windows and pruneDeliveries' "older than".
CREATE INDEX IF NOT EXISTS "commons_notification_delivery_list_idx"
  ON "commons_notification_delivery" ("application", "attempted_at" DESC, "id" DESC);

-- A tenant admin's log and stats — every read of theirs is tenant-scoped.
CREATE INDEX IF NOT EXISTS "commons_notification_delivery_tenant_idx"
  ON "commons_notification_delivery" ("application", "tenant_id", "attempted_at" DESC, "id" DESC);

-- The log filtered to one notification type, or one recipient — with the id tie-break; replace 0002's.
CREATE INDEX IF NOT EXISTS "commons_notification_delivery_type_idx"
  ON "commons_notification_delivery" ("application", "notification_type", "attempted_at" DESC, "id" DESC);
DROP INDEX IF EXISTS "commons_notification_delivery_type_time_idx";

CREATE INDEX IF NOT EXISTS "commons_notification_delivery_recipient_list_idx"
  ON "commons_notification_delivery" ("application", "recipient_ref", "attempted_at" DESC, "id" DESC);
DROP INDEX IF EXISTS "commons_notification_delivery_recipient_idx";

-- "What failed" — partial: most sends succeed, so the failures are a small, separate index.
CREATE INDEX IF NOT EXISTS "commons_notification_delivery_failed_idx"
  ON "commons_notification_delivery" ("application", "attempted_at" DESC, "id" DESC)
  WHERE "status" IN ('failed', 'bounced');

-- A request / job trace, and the log's correlation-id filter. Partial: many sends carry none.
CREATE INDEX IF NOT EXISTS "commons_notification_delivery_correlation_idx"
  ON "commons_notification_delivery" ("application", "correlation_id")
  WHERE "correlation_id" IS NOT NULL;

-- clearContent's "older than, still holding content", and the volume read's content counts. Partial: only rows with
-- stored content, and fewer as retention clears them.
CREATE INDEX IF NOT EXISTS "commons_notification_delivery_content_idx"
  ON "commons_notification_delivery" ("application", "attempted_at")
  WHERE "content" IS NOT NULL;
