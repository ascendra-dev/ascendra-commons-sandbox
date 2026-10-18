-- audit-logging · Postgres/Drizzle adapter — the audit event table.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `persistence/audit-event.schema.ts` and the INSERT in
-- `persistence/postgres-audit-event.repository.ts` — change them together.

CREATE TABLE IF NOT EXISTS "commons_audit_event" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_type"    text NOT NULL,
  "entity_id"      text NOT NULL,
  "tenant_id"      text,
  "actor"          text NOT NULL,
  "action"         text NOT NULL,
  "before"         jsonb,
  "after"          jsonb,
  "correlation_id" text NOT NULL,
  "reason"         text,
  "occurred_at"    timestamptz NOT NULL,
  "application"    text NOT NULL
);

-- "this record's full history"
CREATE INDEX IF NOT EXISTS "commons_audit_event_entity_idx"
  ON "commons_audit_event" ("entity_type", "entity_id");

-- "this tenant's activity feed, recent first"
CREATE INDEX IF NOT EXISTS "commons_audit_event_tenant_time_idx"
  ON "commons_audit_event" ("tenant_id", "occurred_at");

-- No UPDATE/DELETE grants are modelled here: audit records are write-once by
-- construction of `AuditEventRepository` (insert() only). A deployment that
-- wants that enforced at the database can additionally REVOKE update, delete
-- on "commons_audit_event" from the application role.
