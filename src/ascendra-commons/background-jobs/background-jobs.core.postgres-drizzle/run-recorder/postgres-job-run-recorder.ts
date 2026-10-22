import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { JobRunRecorder, JobRunSummary } from '../../background-jobs.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { JOB_RUN_APPLICATION_ID, JOB_RUN_SQL_EXECUTOR } from '../tokens';

/** Refs per row — the runner already caps at this; a recorder wired elsewhere might not. */
const MAX_FAILED_ITEM_REFS = 50;
/** One ref is a `describeItem()` label, not a payload — a job that returns a whole record is cut here. */
const MAX_REF_LENGTH = 500;
/** The full stack `GET /jobs/runs/:id` serves — generous, but never unbounded. */
const MAX_ERROR_LENGTH = 16_000;

/**
 * A correlation id worth storing — a manual run's comes from a request header, so anything else is dropped rather
 * than recorded. Same rule as `audit-logging`, `rate-limiting` and `domain-events`, duplicated so each module stays
 * copyable.
 */
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Text Postgres can store: a NUL byte fails the INSERT — and error messages and item labels can carry one. */
function text(value: unknown, max: number): string {
  const s = String(value).replaceAll('\u0000', '');
  return s.length <= max ? s : `${s.slice(0, max)}… (truncated)`;
}

function dateOf(value: unknown, fallback: Date): Date {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : fallback;
}

function countOf(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 2_147_483_647 ? n : 0;
}

/**
 * Reference `JobRunRecorder` for Postgres via Drizzle — one library-owned
 * `INSERT`, `application` stamped on write, no project-specific logic. The same
 * shape `PostgresAdvisoryLock` and `audit-logging`'s reference repository take.
 * A consumer on this stack wires it through `PostgresJobRunRecorderModule` and
 * writes none of this; a consumer on a different stack provides its own
 * `JobRunRecorder`.
 *
 * One row per run, written after the run — runs are rare and off every request path, so there is no buffer (contrast
 * `domain-events`' recorder, which writes on a producer's own path).
 *
 * Each summary is normalized before it's bound: a NUL byte, an unbounded `describeItem()` label or stack, an Invalid
 * Date or a malformed correlation id would otherwise fail the INSERT — and the best-effort contract would swallow
 * that, so the run would vanish from the history without a trace on the screen.
 *
 * Corresponding table: `job-run.schema.ts` (DDL: `../migrations/`) — the column
 * list below must match it.
 *
 * Honors `JobRunRecorder`'s best-effort contract itself: a write failure is
 * logged and swallowed, never propagated. `IdempotentJobRunner` also guards the
 * call — this is the belt-and-braces, so a consumer wiring the recorder
 * somewhere else still can't turn a telemetry failure into a job failure.
 */
@Injectable()
export class PostgresJobRunRecorder implements JobRunRecorder {
  private readonly logger = new Logger(PostgresJobRunRecorder.name);

  constructor(
    @Inject(JOB_RUN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(JOB_RUN_APPLICATION_ID) private readonly application: string,
  ) {}

  async recordRun(summary: JobRunSummary): Promise<void> {
    try {
      const now = new Date();
      const startedAt = dateOf(summary.startedAt, now);
      const finishedAt = dateOf(summary.finishedAt, startedAt);
      const refs = (Array.isArray(summary.failedItemRefs) ? summary.failedItemRefs : [])
        .slice(0, MAX_FAILED_ITEM_REFS)
        .map((ref) => text(ref, MAX_REF_LENGTH));
      const error = summary.error == null || summary.error === '' ? null : text(summary.error, MAX_ERROR_LENGTH);
      const correlationId =
        summary.correlationId && CORRELATION_ID.test(summary.correlationId) ? summary.correlationId : null;

      await this.db.execute(sql`
        insert into commons_jobs_job_run (
          application, job_name, trigger, started_at, finished_at,
          outcome, items_due, items_processed, items_failed, failed_item_refs, error, correlation_id
        ) values (
          ${this.application}, ${text(summary.jobName, MAX_REF_LENGTH)}, ${summary.trigger}, ${startedAt}, ${finishedAt},
          ${summary.outcome}, ${countOf(summary.itemsDue)}, ${countOf(summary.itemsProcessed)}, ${countOf(summary.itemsFailed)},
          ${this.textArray(refs)}, ${error}, ${correlationId}
        )
      `);
    } catch (err) {
      this.logger.error(
        `Failed to record run of job "${summary.jobName}" (${summary.outcome}) — job outcome is unaffected`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Bind a JS string[] as a real text[] — each element a parameter, never string-interpolated. */
  private textArray(values: string[]): SQL {
    if (values.length === 0) return sql`'{}'::text[]`;
    return sql`array[${sql.join(
      values.map((v) => sql`${v}`),
      sql`, `,
    )}]::text[]`;
  }
}
