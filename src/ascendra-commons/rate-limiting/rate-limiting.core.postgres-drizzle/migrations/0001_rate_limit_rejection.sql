-- rate-limiting · Postgres/Drizzle adapter — the rejection log.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/rate-limit-rejection.schema.ts` and the INSERT
-- column list in `recorder/postgres-rate-limit-event-recorder.ts` — change them together.

CREATE TABLE IF NOT EXISTS "commons_rate_limit_rejection" (
  "id"              bigserial   PRIMARY KEY,
  "application"     text        NOT NULL,
  "route"           text        NOT NULL,
  "identifier"      text        NOT NULL,
  "limit"           integer     NOT NULL,
  "ttl_ms"          integer     NOT NULL,
  "rejected_at"     timestamptz NOT NULL,
  "correlation_id"  text
);

CREATE INDEX IF NOT EXISTS "commons_rate_limit_rejection_time_idx"
  ON "commons_rate_limit_rejection" ("application", "rejected_at");

CREATE INDEX IF NOT EXISTS "commons_rate_limit_rejection_route_idx"
  ON "commons_rate_limit_rejection" ("application", "route", "rejected_at");

CREATE INDEX IF NOT EXISTS "commons_rate_limit_rejection_identifier_idx"
  ON "commons_rate_limit_rejection" ("identifier", "rejected_at");
