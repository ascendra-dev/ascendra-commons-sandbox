-- background-jobs · run history — an index for the runs list filtered to manual runs.
--
-- Released migrations are never edited: a schema change is the next numbered
-- file in this folder (MODULE-STANDARD.md dimension 7). This library never runs
-- them — the consuming project's own migration tool does.
--
-- The table's current shape: `run-recorder/job-run.schema.ts` — change them together.
--
-- 2026-10-22: `?trigger=manual` was the one runs-list filter with no index. Manual runs
-- are a sliver of the history (a Run now, against a schedule firing every few minutes),
-- so the list index walked every run in the range to find a handful.
--
-- A plain CREATE INDEX blocks writes while it builds — the recorder's included. On a
-- large table, build it first with CREATE INDEX CONCURRENTLY (outside a transaction,
-- same name and columns); IF NOT EXISTS then makes this file a no-op for it.

-- The runs list filtered to Run now runs, newest first. Partial: most runs are scheduled.
CREATE INDEX IF NOT EXISTS "commons_jobs_job_run_manual_idx"
  ON "commons_jobs_job_run" ("application", "started_at" DESC, "id" DESC)
  WHERE "trigger" = 'manual';
