-- rate-limiting · Postgres/Drizzle adapter — one row per rejection window, not per 429.
--
-- 0001 wrote one row per rejected request, so a flood against a throttled route
-- became one INSERT per blocked request — the attack moved from the handler onto
-- Postgres. The recorder now counts rejections in memory and upserts them every
-- few seconds as one row per (route, identifier, limit, ttl, minute, correlation
-- id), so write volume tracks the number of distinct sources, not the request rate.
--
-- Existing rows are folded into that shape: each becomes a 1-count row in its
-- minute, then rows sharing a key are merged into one.
--
-- Requires Postgres 15+ (UNIQUE NULLS NOT DISTINCT — most rejections carry no
-- correlation id, and those must still merge into one row per key).

ALTER TABLE "commons_rate_limit_rejection" RENAME COLUMN "rejected_at" TO "last_rejected_at";

ALTER TABLE "commons_rate_limit_rejection"
  ADD COLUMN "window_start"      timestamptz,
  ADD COLUMN "first_rejected_at" timestamptz,
  ADD COLUMN "rejection_count"   integer NOT NULL DEFAULT 1;

UPDATE "commons_rate_limit_rejection"
  SET "window_start" = date_trunc('minute', "last_rejected_at"),
      "first_rejected_at" = "last_rejected_at";

-- Merge rows that now share a key into the lowest id of each group. GROUP BY
-- treats NULL correlation ids as equal — the same rule as the constraint below.
UPDATE "commons_rate_limit_rejection" AS r
  SET "rejection_count" = g.total, "first_rejected_at" = g.first_at, "last_rejected_at" = g.last_at
  FROM (
    SELECT min("id") AS keep_id, count(*) AS total,
           min("first_rejected_at") AS first_at, max("last_rejected_at") AS last_at
    FROM "commons_rate_limit_rejection"
    GROUP BY "application", "route", "identifier", "limit", "ttl_ms", "window_start", "correlation_id"
    HAVING count(*) > 1
  ) AS g
  WHERE r."id" = g.keep_id;

DELETE FROM "commons_rate_limit_rejection"
  WHERE "id" NOT IN (
    SELECT min("id") FROM "commons_rate_limit_rejection"
    GROUP BY "application", "route", "identifier", "limit", "ttl_ms", "window_start", "correlation_id"
  );

ALTER TABLE "commons_rate_limit_rejection"
  ALTER COLUMN "window_start" SET NOT NULL,
  ALTER COLUMN "first_rejected_at" SET NOT NULL,
  ALTER COLUMN "rejection_count" DROP DEFAULT;

-- The recorder's ON CONFLICT target.
ALTER TABLE "commons_rate_limit_rejection"
  ADD CONSTRAINT "commons_rate_limit_rejection_window_key"
  UNIQUE NULLS NOT DISTINCT ("application", "route", "identifier", "limit", "ttl_ms", "window_start", "correlation_id");

-- The read indexes keyed on the old per-request timestamp; reads now key on the window.
DROP INDEX IF EXISTS "commons_rate_limit_rejection_time_idx";
DROP INDEX IF EXISTS "commons_rate_limit_rejection_route_idx";
DROP INDEX IF EXISTS "commons_rate_limit_rejection_identifier_idx";

CREATE INDEX IF NOT EXISTS "commons_rate_limit_rejection_time_idx"
  ON "commons_rate_limit_rejection" ("application", "window_start");

CREATE INDEX IF NOT EXISTS "commons_rate_limit_rejection_route_idx"
  ON "commons_rate_limit_rejection" ("application", "route", "window_start");

CREATE INDEX IF NOT EXISTS "commons_rate_limit_rejection_identifier_idx"
  ON "commons_rate_limit_rejection" ("identifier", "window_start");
