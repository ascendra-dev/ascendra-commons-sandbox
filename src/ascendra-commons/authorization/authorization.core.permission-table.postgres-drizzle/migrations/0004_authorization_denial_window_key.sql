-- authorization · the denied-requests log — one window per actor, action, route and minute, whatever the correlation id.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/schema.ts` (`authzDenial`).
--
-- 2026-10-23, found seeding the sandbox: 0003's window key held the correlation id, and every request carries its
-- own — so a burst of 403s (an attacker's, at their rate) wrote a row per request instead of one per minute. The key
-- drops it; `correlation_id` keeps the latest denied request's id as a sample to trace. Rows that differed only by
-- correlation id are merged first.

ALTER TABLE "commons_authz_denial" DROP CONSTRAINT IF EXISTS "commons_authz_denial_window_uq";

WITH merged AS (
  SELECT min(id) AS keep, sum(denial_count) AS total, min(first_denied_at) AS first_at, max(last_denied_at) AS last_at,
         (array_agg(correlation_id ORDER BY last_denied_at DESC) FILTER (WHERE correlation_id IS NOT NULL))[1] AS sample
  FROM "commons_authz_denial"
  GROUP BY application, actor_id, tenant_id, action, method, route, window_start
  HAVING count(*) > 1
)
UPDATE "commons_authz_denial" d
SET denial_count = m.total, first_denied_at = m.first_at, last_denied_at = m.last_at, correlation_id = m.sample
FROM merged m
WHERE d.id = m.keep;

DELETE FROM "commons_authz_denial" d
USING "commons_authz_denial" k
WHERE d.application = k.application AND d.actor_id = k.actor_id AND d.tenant_id IS NOT DISTINCT FROM k.tenant_id
  AND d.action = k.action AND d.method = k.method AND d.route = k.route AND d.window_start = k.window_start
  AND d.id > k.id;

ALTER TABLE "commons_authz_denial"
  ADD CONSTRAINT "commons_authz_denial_window_uq" UNIQUE NULLS NOT DISTINCT
    ("application", "actor_id", "tenant_id", "action", "method", "route", "window_start");
