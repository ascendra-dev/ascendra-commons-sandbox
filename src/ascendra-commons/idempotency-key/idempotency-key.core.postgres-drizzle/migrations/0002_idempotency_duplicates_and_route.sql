-- idempotency-key · Postgres/Drizzle adapter (Model 1) — 2026-10-21.
--
-- Counts the duplicates the pattern absorbs, and records each claim's endpoint:
--   replay_count      — repeat requests answered with the saved response
--   conflict_count    — repeat requests turned away with a 409 while the first was still running
--   last_duplicate_at — the latest of either
--   route             — the endpoint's route pattern (/payments/:id, never the resolved URL), set by the claim
--
-- The two counts are kept in memory by PostgresIdempotencyStore and added here every few seconds — never written on
-- the duplicate's own request. Existing rows get 0 / NULL; they age out with the 24h cleanup.

ALTER TABLE "commons_idempotency_key"
  ADD COLUMN IF NOT EXISTS "replay_count"      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "conflict_count"    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_duplicate_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "route"             text;

-- listClaims({ route }) and claimsByRoute()'s grouping over a period.
CREATE INDEX IF NOT EXISTS "commons_idempotency_key_route_idx"
  ON "commons_idempotency_key" ("route", "created_at");
