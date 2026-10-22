-- background-jobs · Postgres/Drizzle lease-table lock (PostgresLeaseLock — an
-- alternative to the core's session-level PostgresAdvisoryLock; unused, the table is harmless).
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `lock/lease-lock.schema.ts` and the statements in
-- `lock/postgres-lease-lock.ts` — change them together.
--
-- `locked_until` is the lease: a holder that crashes without releasing lets the
-- row expire, and the next run claims it via the conditional upsert. The holder
-- renews `locked_until` on a heartbeat while its run is in progress.

CREATE TABLE IF NOT EXISTS "commons_jobs_lock" (
  "application"  text        NOT NULL,
  "lock_key"     text        NOT NULL,
  "holder"       text        NOT NULL,
  "acquired_at"  timestamptz NOT NULL DEFAULT now(),
  "locked_until" timestamptz NOT NULL,
  PRIMARY KEY ("application", "lock_key")
);
