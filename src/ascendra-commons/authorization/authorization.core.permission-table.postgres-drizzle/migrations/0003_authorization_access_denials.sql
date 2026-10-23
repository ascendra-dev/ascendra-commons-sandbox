-- authorization · permission-table Postgres/Drizzle adapter — the denied-requests log.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/schema.ts` (`authzDenial`) and the INSERT in
-- `denials/postgres-access-denial-recorder.ts` — change them together.
--
-- Every 403 AuthorizationGuard answers, counted in memory and written every few seconds: one row per actor, action,
-- route, method, correlation id and minute (`window_start`), with how many (`denial_count`). A request path — maybe an
-- attacker's — never waits on this table. Requires PostgreSQL 15+ (NULLS NOT DISTINCT). Retention: the app prunes
-- (`PostgresAccessDenialRetention.pruneDenials`).

CREATE TABLE IF NOT EXISTS "commons_authz_denial" (
  "id"              bigserial   PRIMARY KEY,
  "application"     text        NOT NULL,
  "actor_id"        text        NOT NULL,
  "tenant_id"       text,
  "action"          text        NOT NULL,
  "method"          text        NOT NULL,
  "route"           text        NOT NULL,
  "window_start"    timestamptz NOT NULL,
  "denial_count"    integer     NOT NULL,
  "first_denied_at" timestamptz NOT NULL,
  "last_denied_at"  timestamptz NOT NULL,
  "correlation_id"  text,
  CONSTRAINT "commons_authz_denial_window_uq" UNIQUE NULLS NOT DISTINCT
    ("application", "actor_id", "tenant_id", "action", "method", "route", "window_start", "correlation_id")
);

-- The log newest first (keyset on window_start, id), the summary's period, and the pruner's "older than".
CREATE INDEX IF NOT EXISTS "commons_authz_denial_list_idx"
  ON "commons_authz_denial" ("application", "window_start" DESC, "id" DESC);
-- One tenant's denials — a tenant admin's view.
CREATE INDEX IF NOT EXISTS "commons_authz_denial_tenant_idx"
  ON "commons_authz_denial" ("application", "tenant_id", "window_start" DESC, "id" DESC);
-- One actor's denials (a person's profile, "why can't I").
CREATE INDEX IF NOT EXISTS "commons_authz_denial_actor_idx"
  ON "commons_authz_denial" ("application", "actor_id", "window_start" DESC, "id" DESC);
-- A trace. Partial: only requests that sent a correlation id carry one.
CREATE INDEX IF NOT EXISTS "commons_authz_denial_correlation_idx"
  ON "commons_authz_denial" ("correlation_id") WHERE "correlation_id" IS NOT NULL;
