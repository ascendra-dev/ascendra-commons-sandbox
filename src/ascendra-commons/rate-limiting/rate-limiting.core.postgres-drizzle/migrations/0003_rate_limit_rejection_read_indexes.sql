-- rate-limiting · Postgres/Drizzle adapter — indexes for the reads the rate-limit screens make.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/rate-limit-rejection.schema.ts` — change them together.
--
-- Found by EXPLAIN on the sandbox (module review, 2026-10-21): the list newest-first
-- keysets on (window_start, id), but 0002's (application, window_start) has no id,
-- so the list sorted every matching row; and a trace by correlation id had no index
-- at all — it scanned the application's rows.
--
-- A plain CREATE INDEX blocks writes while it builds — the recorder's upserts
-- included. On a large table, build each index first with CREATE INDEX CONCURRENTLY
-- (outside a transaction, same name and columns); IF NOT EXISTS then makes this file
-- a no-op for it.

-- The list newest-first (keyset on window_start, id), the catalog / top-identifiers /
-- volume windows, and the pruner's "older than" — replaces 0002's time index.
CREATE INDEX IF NOT EXISTS "commons_rate_limit_rejection_list_idx"
  ON "commons_rate_limit_rejection" ("application", "window_start" DESC, "id" DESC);

DROP INDEX IF EXISTS "commons_rate_limit_rejection_time_idx";

-- A request / job trace, and the list's correlation-id filter. Partial: most
-- rejected callers send no correlation id, so those rows stay out of the index.
CREATE INDEX IF NOT EXISTS "commons_rate_limit_rejection_correlation_idx"
  ON "commons_rate_limit_rejection" ("correlation_id")
  WHERE "correlation_id" IS NOT NULL;
