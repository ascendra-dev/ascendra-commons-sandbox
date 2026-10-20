-- audit-logging · Postgres/Drizzle adapter — indexes for the reads the audit screens make.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/audit-event.schema.ts` — change them together.
--
-- 0001 indexed only (tenant_id, occurred_at) and (entity_type, entity_id). Every read
-- is also scoped by `application`, so a platform-wide read — the list, the overview
-- stats, the retention figures — scanned the whole table, and so did a request / job
-- trace (correlation_id) and an actor's activity.
--
-- A plain CREATE INDEX blocks writes to the table while it builds — audit inserts
-- included, and a change's transaction waits on its audit insert. On a large table,
-- build each index first with CREATE INDEX CONCURRENTLY (outside a transaction, same
-- name and columns); IF NOT EXISTS then makes this file a no-op for it.

-- The list newest-first (keyset on occurred_at, id), and the platform-wide stats.
CREATE INDEX IF NOT EXISTS "commons_audit_event_app_time_idx"
  ON "commons_audit_event" ("application", "occurred_at" DESC, "id" DESC);

-- A request / job trace, and the list's correlation-id filter.
CREATE INDEX IF NOT EXISTS "commons_audit_event_correlation_idx"
  ON "commons_audit_event" ("correlation_id");

-- One actor's activity, and the list's actor filter.
CREATE INDEX IF NOT EXISTS "commons_audit_event_actor_idx"
  ON "commons_audit_event" ("application", "actor", "occurred_at" DESC);
