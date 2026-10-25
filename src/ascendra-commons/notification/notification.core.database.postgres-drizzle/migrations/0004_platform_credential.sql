-- notification · a platform default provider credential.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The tables' current shape: `persistence/config.schema.ts`. Requires PostgreSQL 15+.
--
-- 2026-10-25 review: a credential had to belong to a tenant, so a notification with no tenant (to platform staff)
-- could never send, and every tenant needed its own provider account. A row with `tenant_id` NULL is now the
-- platform's own account: tenantless sends use it, and — only when the app turns `tenantCredentialFallback` on — a
-- tenant with no credential of its own sends through it too. Never another tenant's account.
--
-- The primary key can't hold a NULL, so a NULLS NOT DISTINCT unique constraint replaces it (one row per application,
-- channel and tenant, the platform's row included).

ALTER TABLE "commons_notification_provider_credential" DROP CONSTRAINT IF EXISTS "commons_notification_provider_credential_pkey";
ALTER TABLE "commons_notification_provider_credential" ALTER COLUMN "tenant_id" DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE "commons_notification_provider_credential"
    ADD CONSTRAINT "commons_notification_provider_credential_uq" UNIQUE NULLS NOT DISTINCT ("application", "channel", "tenant_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
