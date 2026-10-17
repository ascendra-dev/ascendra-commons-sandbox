-- Reference migration for the audit-logging pattern's Postgres/Drizzle adapter.
--
-- This library never runs migrations against a consumer's database (see
-- MODULE-STANDARD.md dimension 7 — the DB instance and its migration history are
-- always consumer-owned). Copy this statement into the consuming project's own
-- migration tooling, or export `auditEventTable` from `audit-event.schema.ts`
-- and let `drizzle-kit generate` produce the equivalent.
--
-- Keep this in sync with `audit-event.schema.ts` and
-- `postgres-audit-event.repository.ts` — the three describe one table.

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
