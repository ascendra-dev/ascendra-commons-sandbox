import { sql } from 'drizzle-orm';
import { bigserial, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_jobs_job_run` table — one concrete Postgres/Drizzle shape of the
 * generic `JobRunSummary` (see `../../job-run-recorder.interface.ts`), plus
 * `application`. This is the single source of truth for the reference schema:
 * `PostgresJobRunRecorder` writes exactly these columns — change the two
 * together, and ship the change as the next numbered file in `../migrations/`
 * (never an edit to a released one).
 *
 * A consuming project reads its run-history admin screen through this typed
 * table — the adapter itself ships no read path — but never re-exports it into
 * the schema files `drizzle-kit` reads (the DDL comes from `../migrations/`). A project on a different stack
 * ignores this file and provides its own `JobRunRecorder`.
 *
 * `application` — which Ascendra app the row belongs to — is on every row and
 * in every read's `application = $1` filter, so the table stays correct
 * whether each app keeps its own database (the common case, one constant
 * value) or job-run history is ever consolidated into one shared operational
 * database (rows disambiguated). Stamped from
 * `PostgresJobRunRecorderModule.forRoot({ application })`. This is the
 * `MODULE-STANDARD.md` dimension-4 call made the same way `notification` and
 * `audit-logging` make it — carried now so a later consolidation needs no
 * backfill.
 */
export const jobRunTable = pgTable(
  'commons_jobs_job_run',
  {
    /** Assigned by Postgres on insert — an append-only ordered log, never looked up by id from outside. */
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    application: text('application').notNull(),
    jobName: text('job_name').notNull(),
    /** 'scheduled' | 'bootstrap' | 'manual' — see `JobRunTrigger`. */
    trigger: text('trigger').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** 'completed' | 'job_failed' — see `JobRunOutcome`. A run with itemsFailed > 0 is still 'completed'. */
    outcome: text('outcome').notNull(),
    itemsDue: integer('items_due').notNull(),
    itemsProcessed: integer('items_processed').notNull(),
    itemsFailed: integer('items_failed').notNull(),
    /** describeItem() output for the items that failed this run, capped by the runner. A diagnosis sample. */
    failedItemRefs: text('failed_item_refs').array().notNull().default([]),
    /** Nullable — the job-level error's stack, present only when outcome = 'job_failed'. */
    error: text('error'),
    /** Nullable — the request/trace id a manual run belongs to (rollout item 4 / cross-module trace). */
    correlationId: text('correlation_id'),
  },
  (t) => [
    /** The runs list newest-first, the summary / volume periods, and the pruner's scan. */
    index('commons_jobs_job_run_list_idx').on(t.application, t.startedAt.desc(), t.id.desc()),
    /** One job's runs, the dashboard's latest runs per job, and the failed-items window. */
    index('commons_jobs_job_run_job_idx').on(t.application, t.jobName, t.startedAt.desc(), t.id.desc()),
    /** The runs list filtered to failures — partial: most runs are clean. */
    index('commons_jobs_job_run_failing_idx')
      .on(t.application, t.startedAt.desc(), t.id.desc())
      .where(sql`${t.outcome} = 'job_failed' or ${t.itemsFailed} > 0`),
    /** A trace — partial: only manual runs carry a correlation id. */
    index('commons_jobs_job_run_correlation_idx').on(t.correlationId).where(sql`${t.correlationId} is not null`),
  ],
);
