-- authorization · permission-table Postgres/Drizzle adapter — action scope, expiring role assignments, read indexes.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The tables' current shape: `persistence/schema.ts`.
--
-- 2026-10-23 review: a role holding a platform-wide action (reading every tenant's rate limits, running a job) could
-- be assigned inside a tenant — a tenant admin made itself a platform admin. Each action now says where it may be
-- granted (`scope`); a role with any platform action is assigned globally only. A role assignment may expire
-- (`expires_at` — cover, a contractor). The admin console's reads (assignments by tenant / role, the delegation
-- ledger) had no index.
--
-- A plain CREATE INDEX blocks writes while it builds. On a large table, build each index first with
-- CREATE INDEX CONCURRENTLY (outside a transaction, same name and columns); IF NOT EXISTS then makes it a no-op here.

ALTER TABLE "commons_authz_action" ADD COLUMN IF NOT EXISTS "scope" text NOT NULL DEFAULT 'tenant';
DO $$ BEGIN
  ALTER TABLE "commons_authz_action"
    ADD CONSTRAINT "commons_authz_action_scope_ck" CHECK ("scope" IN ('platform', 'tenant'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "commons_authz_user_role" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz;

-- The assignment ledger by tenant (a tenant admin's view), newest first; and every holder of a role.
CREATE INDEX IF NOT EXISTS "commons_authz_user_role_tenant_idx"
  ON "commons_authz_user_role" ("tenant_id", "granted_at" DESC);
CREATE INDEX IF NOT EXISTS "commons_authz_user_role_role_idx"
  ON "commons_authz_user_role" ("role_id", "tenant_id");

-- The delegation ledger newest first — all of it, and one tenant's — with the keyset tie-break.
CREATE INDEX IF NOT EXISTS "commons_authz_delegation_list_idx"
  ON "commons_authz_delegation" ("created_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "commons_authz_delegation_tenant_idx"
  ON "commons_authz_delegation" ("tenant_id", "created_at" DESC, "id" DESC);
-- What a user has lent (their side of the ledger, and the delegations a role revoke leaves lapsed).
CREATE INDEX IF NOT EXISTS "commons_authz_delegation_granter_idx"
  ON "commons_authz_delegation" ("granter_id", "tenant_id");
