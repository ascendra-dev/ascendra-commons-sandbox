-- background-jobs · run history — an index for every read the admin screens make.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `run-recorder/job-run.schema.ts` — change them together.
--
-- 2026-10-22: 0001's one index, (application, job_name, started_at), served one job's
-- history but not the runs list across every job, carried no id for the keyset
-- tie-break, and a trace had no index at all.
--
-- A plain CREATE INDEX blocks writes while it builds — the recorder's included. On a
-- large table, build each index first with CREATE INDEX CONCURRENTLY (outside a
-- transaction, same name and columns); IF NOT EXISTS then makes this file a no-op for it.

-- The runs list newest-first (keyset on started_at, id), the summary / volume
-- periods, and the pruner's "older than".
CREATE INDEX IF NOT EXISTS "commons_jobs_job_run_list_idx"
  ON "commons_jobs_job_run" ("application", "started_at" DESC, "id" DESC);

-- One job's runs, the dashboard's latest-runs-per-job and the distinct job names it
-- walks, and the failed-items window — replaces 0001's index.
CREATE INDEX IF NOT EXISTS "commons_jobs_job_run_job_idx"
  ON "commons_jobs_job_run" ("application", "job_name", "started_at" DESC, "id" DESC);

DROP INDEX IF EXISTS "commons_jobs_job_run_application_job_time_idx";

-- The runs list filtered to failures (a job failure, or a run with failed items).
-- Partial: most runs are clean.
CREATE INDEX IF NOT EXISTS "commons_jobs_job_run_failing_idx"
  ON "commons_jobs_job_run" ("application", "started_at" DESC, "id" DESC)
  WHERE "outcome" = 'job_failed' OR "items_failed" > 0;

-- A trace, and the list's correlation-id filter. Partial: only manual runs carry one.
CREATE INDEX IF NOT EXISTS "commons_jobs_job_run_correlation_idx"
  ON "commons_jobs_job_run" ("correlation_id")
  WHERE "correlation_id" IS NOT NULL;
