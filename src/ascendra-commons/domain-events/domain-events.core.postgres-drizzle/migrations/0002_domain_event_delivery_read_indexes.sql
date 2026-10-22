-- domain-events · delivery log — every read moves to occurred_at, with indexes for each.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/domain-event-delivery.schema.ts` — change them together.
--
-- 2026-10-22: the screens count deliveries by when the event occurred (occurred_at), not
-- when the row was written — the two are the same moment in-process, and occurred_at is
-- the business time a backdated or replayed event carries. 0001's indexes were on
-- delivered_at, without the id the list keysets on; and a trace had no index at all.
--
-- A plain CREATE INDEX blocks writes while it builds — the recorder's flushes included.
-- On a large table, build each index first with CREATE INDEX CONCURRENTLY (outside a
-- transaction, same name and columns); IF NOT EXISTS then makes this file a no-op for it.

-- The log newest-first (keyset on occurred_at, id), the summary / catalog / volume
-- periods, and the pruner's "older than".
CREATE INDEX IF NOT EXISTS "commons_domain_events_delivery_list_idx"
  ON "commons_domain_events_delivery" ("application", "occurred_at" DESC, "id" DESC);

-- The log filtered by event name — replaces 0001's (application, event_name, delivered_at).
CREATE INDEX IF NOT EXISTS "commons_domain_events_delivery_event_idx"
  ON "commons_domain_events_delivery" ("application", "event_name", "occurred_at" DESC, "id" DESC);

DROP INDEX IF EXISTS "commons_domain_events_delivery_event_time_idx";

-- The log filtered by status — replaces 0001's (application, status, delivered_at).
CREATE INDEX IF NOT EXISTS "commons_domain_events_delivery_status_occurred_idx"
  ON "commons_domain_events_delivery" ("application", "status", "occurred_at" DESC, "id" DESC);

DROP INDEX IF EXISTS "commons_domain_events_delivery_status_idx";

-- A request / job trace, and the log's correlation-id filter. Partial: not every emit
-- carries a correlation id.
CREATE INDEX IF NOT EXISTS "commons_domain_events_delivery_correlation_idx"
  ON "commons_domain_events_delivery" ("correlation_id")
  WHERE "correlation_id" IS NOT NULL;
