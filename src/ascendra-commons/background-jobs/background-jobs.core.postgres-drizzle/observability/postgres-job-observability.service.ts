import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  calendarDays,
  decodeKeysetCursor,
  encodeKeysetCursor,
  humanizeDuration,
  InvalidJobRunCursorError,
  isRunId,
  parseCadence,
  type FailedItemSummary,
  type JobObservabilityPort,
  type JobRunOutcome,
  type JobRunRecord,
  type JobStatus,
  type ParsedCadence,
  type RunHistoryPage,
  type RunHistoryQuery,
  type RunPeriodQuery,
  type RunSummary,
  type RunVolume,
} from '../../background-jobs.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { JOB_OBSERVABILITY_CADENCES, JOB_RUN_APPLICATION_ID, JOB_RUN_SQL_EXECUTOR } from '../tokens';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** How many recent runs per job `listJobStatus()` inspects. */
const STATUS_RUNS_PER_JOB = 50;
/** A job is overdue once the gap since its last run exceeds its cadence by this factor. */
const OVERDUE_FACTOR = 1.5;
/** Minimum scheduled+non-failed runs needed before a cadence can be inferred from history. */
const MIN_RUNS_TO_INFER = 3;
/**
 * List rows (`getRunHistory` / `listJobStatus`) truncate `error` to this many
 * characters — the full stack trace on every list row was an unintended
 * info-leak risk, not just a payload-size concern. The untruncated stack is
 * available via `getRun`.
 */
const ERROR_TRUNCATE_LENGTH = 500;
/** How many of a job's most recent runs `getFailedItems` scans for recurring refs. */
const FAILED_ITEMS_RUN_WINDOW = 50;
/** Default "recurs in at least this many of the scanned runs" bar for `getFailedItems`. */
const DEFAULT_MIN_FAILED_RUNS = 2;
const VOLUME_DAYS = 30;

const RUN_COLUMNS = sql`
  id, job_name, trigger, started_at, finished_at, outcome,
  items_due, items_processed, items_failed, failed_item_refs, error, correlation_id
`;

/** `started_at` at the column's own precision (microseconds), for the keyset cursor — a JS `Date` keeps milliseconds. */
const STARTED_AT_KEY = sql`to_char(started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started_at_key`;

/**
 * `JobObservabilityPort` for Postgres/Drizzle — read-only reporting over
 * `commons_jobs_job_run`. Every read is `application`-scoped and counts by
 * `started_at`, each on an index (`../migrations/0003_job_run_read_indexes.sql`).
 * No write path; the adapter's `PostgresJobRunRecorder` owns writes.
 */
@Injectable()
export class PostgresJobObservabilityService implements JobObservabilityPort {
  private readonly cadences: Map<string, ParsedCadence>;

  constructor(
    @Inject(JOB_RUN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(JOB_RUN_APPLICATION_ID) private readonly application: string,
    @Inject(JOB_OBSERVABILITY_CADENCES) cadences: Record<string, string | number>,
  ) {
    this.cadences = new Map(Object.entries(cadences).map(([name, c]) => [name, parseCadence(c)]));
  }

  async getRunHistory(query: RunHistoryQuery = {}): Promise<RunHistoryPage> {
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const asc = query.order === 'asc';
    const dir = asc ? sql`asc` : sql`desc`;

    const conds: SQL[] = [sql`application = ${this.application}`];
    if (query.jobName !== undefined) conds.push(sql`job_name = ${query.jobName}`);
    if (query.outcome !== undefined) conds.push(sql`outcome = ${query.outcome}`);
    if (query.trigger !== undefined) conds.push(sql`trigger = ${query.trigger}`);
    if (query.hasFailedItems === true) conds.push(sql`items_failed > 0`);
    if (query.hasFailedItems === false) conds.push(sql`items_failed = 0`);
    if (query.correlationId !== undefined) conds.push(sql`correlation_id = ${query.correlationId}`);
    if (query.since) conds.push(sql`started_at >= ${query.since}`);
    if (query.until) conds.push(sql`started_at < ${query.until}`);

    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor);
      // A cursor that doesn't decode was never issued here — silently starting from the top would repeat page one.
      if (!cursor) throw new InvalidJobRunCursorError(`Unrecognized cursor "${query.cursor}"`);
      const ts = sql`${cursor.timestamp}::timestamptz`;
      const id = sql`${cursor.id}::bigint`;
      // The leading bound lets the scan start at the boundary (an Index Cond); the OR alone is only a Filter.
      conds.push(
        asc
          ? sql`started_at >= ${ts} and (started_at > ${ts} or id > ${id})`
          : sql`started_at <= ${ts} and (started_at < ${ts} or id < ${id})`,
      );
    }

    const rows = (
      await this.db.execute(sql`
        select ${RUN_COLUMNS}, ${STARTED_AT_KEY} from commons_jobs_job_run
        where ${sql.join(conds, sql` and `)}
        order by started_at ${dir}, id ${dir}
        limit ${limit + 1}
      `)
    ).rows;

    if (rows.length > limit) {
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { runs: page.map(mapRow), nextCursor: encodeKeysetCursor(String(last.started_at_key), String(last.id)) };
    }
    return { runs: rows.map(mapRow) };
  }

  async listJobStatus(): Promise<JobStatus[]> {
    // The distinct job names by a skip scan over the job index (one probe per name, not a pass over every run), then
    // each job's latest runs by the same index. A `row_number()` over the whole history read every row on every load.
    const rows = (
      await this.db.execute(sql`
        with recursive names as (
          (select job_name from commons_jobs_job_run where application = ${this.application} order by job_name limit 1)
          union all
          select (
            select r.job_name from commons_jobs_job_run r
            where r.application = ${this.application} and r.job_name > names.job_name
            order by r.job_name limit 1
          )
          from names where names.job_name is not null
        )
        select runs.* from names
        cross join lateral (
          select ${RUN_COLUMNS} from commons_jobs_job_run
          where application = ${this.application} and job_name = names.job_name
          order by started_at desc, id desc
          limit ${STATUS_RUNS_PER_JOB}
        ) runs
        where names.job_name is not null
        order by runs.job_name, runs.started_at desc, runs.id desc
      `)
    ).rows.map(mapRow);

    const byJob = new Map<string, JobRunRecord[]>();
    for (const run of rows) {
      const list = byJob.get(run.jobName);
      if (list) list.push(run);
      else byJob.set(run.jobName, [run]);
    }
    for (const name of this.cadences.keys()) if (!byJob.has(name)) byJob.set(name, []);

    const now = Date.now();
    return [...byJob.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, runs]) => this.toStatus(name, runs, now));
  }

  async runSummary(query: RunPeriodQuery = {}): Promise<RunSummary> {
    const row = (
      await this.db.execute(sql`
        select
          count(*)::bigint as runs,
          count(*) filter (where outcome = 'completed' and items_failed = 0)::bigint as clean,
          count(*) filter (where outcome = 'completed' and items_failed > 0)::bigint as with_failed_items,
          count(*) filter (where outcome = 'job_failed')::bigint as job_failed,
          count(*) filter (where trigger = 'manual')::bigint as manual,
          coalesce(sum(items_processed), 0)::bigint as items_processed,
          coalesce(sum(items_failed), 0)::bigint as items_failed,
          count(distinct job_name)::bigint as jobs
        from commons_jobs_job_run
        where ${this.period(query)}
      `)
    ).rows[0] as Record<string, unknown> | undefined;
    return {
      runs: Number(row?.runs ?? 0),
      clean: Number(row?.clean ?? 0),
      withFailedItems: Number(row?.with_failed_items ?? 0),
      jobFailed: Number(row?.job_failed ?? 0),
      manual: Number(row?.manual ?? 0),
      itemsProcessed: Number(row?.items_processed ?? 0),
      itemsFailed: Number(row?.items_failed ?? 0),
      jobs: Number(row?.jobs ?? 0),
    };
  }

  async volume(timeZone = 'UTC', now: Date = new Date()): Promise<RunVolume> {
    const app = sql`application = ${this.application}`;
    // Whole calendar days in the viewer's zone: from the first day's local midnight, bucketed by local date.
    const days = calendarDays(now, VOLUME_DAYS, timeZone);
    const perDayRows = (
      await this.db.execute(sql`
        select
          to_char(started_at at time zone ${timeZone}, 'YYYY-MM-DD') as day,
          count(*)::bigint as runs,
          count(*) filter (where outcome = 'completed' and items_failed > 0)::bigint as with_failed_items,
          count(*) filter (where outcome = 'job_failed')::bigint as job_failed
        from commons_jobs_job_run
        where ${app} and started_at >= (${days[0]}::date::timestamp at time zone ${timeZone})
        group by 1
      `)
    ).rows as Array<Record<string, unknown>>;

    const totals = (
      await this.db.execute(sql`
        select min(started_at) as oldest, count(*)::bigint as total
        from commons_jobs_job_run
        where ${app}
      `)
    ).rows[0] as { oldest: unknown; total: string | number } | undefined;

    const size = (await this.db.execute(sql`select pg_total_relation_size('commons_jobs_job_run') as bytes`)).rows[0] as
      | { bytes: string | number | null }
      | undefined;

    const byDay = new Map(perDayRows.map((r) => [String(r.day), r]));
    return {
      oldestStartedAt: totals?.oldest == null ? null : asDate(totals.oldest),
      rowCount: Number(totals?.total ?? 0),
      tableSizeBytes: size?.bytes == null ? null : Number(size.bytes),
      perDay: days.map((day) => {
        const r = byDay.get(day);
        return {
          day,
          runs: Number(r?.runs ?? 0),
          withFailedItems: Number(r?.with_failed_items ?? 0),
          jobFailed: Number(r?.job_failed ?? 0),
        };
      }),
    };
  }

  private period(query: RunPeriodQuery): SQL {
    const app = sql`application = ${this.application}`;
    return query.since ? sql`${app} and started_at >= ${query.since}` : app;
  }

  private toStatus(name: string, runs: JobRunRecord[], now: number): JobStatus {
    const lastRun = runs[0] ?? null;
    const lastSuccessAt = runs.find((r) => r.outcome === 'completed' && r.itemsFailed === 0)?.startedAt ?? null;

    let consecutiveFailures = 0;
    for (const run of runs) {
      if (run.outcome === 'job_failed' || run.itemsFailed > 0) consecutiveFailures++;
      else break;
    }

    const cadence = this.cadenceFor(name, runs);
    let overdue = false;
    let overdueBy: string | null = null;
    if (cadence && lastRun) {
      const gapSeconds = (now - lastRun.startedAt.getTime()) / 1000;
      if (gapSeconds > cadence.seconds * OVERDUE_FACTOR) {
        overdue = true;
        overdueBy = humanizeDuration(gapSeconds - cadence.seconds);
      }
    } else if (cadence && !lastRun) {
      overdue = true;
    }

    return { name, lastRun, lastSuccessAt, consecutiveFailures, cadence, overdue, overdueBy };
  }

  async getRun(id: string): Promise<JobRunRecord | null> {
    // Not a bigserial id → no such run (a 404), never a failed `::bigint` cast (a 500).
    if (!isRunId(id)) return null;
    const { rows } = await this.db.execute(sql`
      select ${RUN_COLUMNS} from commons_jobs_job_run
      where application = ${this.application} and id = ${id}::bigint
    `);
    const row = rows[0];
    return row ? mapRunDetail(row) : null;
  }

  async getFailedItems(jobName: string, minRuns = DEFAULT_MIN_FAILED_RUNS): Promise<FailedItemSummary[]> {
    const rows = (
      await this.db.execute(sql`
        with recent_runs as (
          select started_at, failed_item_refs
          from commons_jobs_job_run
          where application = ${this.application} and job_name = ${jobName}
          order by started_at desc, id desc
          limit ${FAILED_ITEMS_RUN_WINDOW}
        )
        select ref as item_ref, count(*)::int as failure_count, max(started_at) as last_failed_at
        from recent_runs, unnest(failed_item_refs) as ref
        group by ref
        having count(*) >= ${minRuns}
        order by failure_count desc, last_failed_at desc
      `)
    ).rows;

    return rows.map((row) => ({
      itemRef: String(row.item_ref),
      failureCount: Number(row.failure_count),
      lastFailedAt: asDate(row.last_failed_at),
    }));
  }

  private cadenceFor(name: string, runs: JobRunRecord[]): JobStatus['cadence'] {
    const declared = this.cadences.get(name);
    if (declared) return { source: 'declared', seconds: declared.seconds, label: declared.label };

    const scheduledTimes = runs
      .filter((r) => r.trigger === 'scheduled' && r.outcome !== 'job_failed')
      .map((r) => r.startedAt.getTime())
      .sort((a, b) => a - b);
    if (scheduledTimes.length < MIN_RUNS_TO_INFER) return null;

    const gaps: number[] = [];
    for (let i = 1; i < scheduledTimes.length; i++) gaps.push((scheduledTimes[i] - scheduledTimes[i - 1]) / 1000);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    // Runs that started together (a burst of bootstraps, a backfill) give no cadence — a 0s one is "overdue" forever.
    if (median < 1) return null;
    return { source: 'inferred', seconds: Math.round(median), label: humanizeDuration(median) };
  }
}

function mapRowBase(row: Record<string, unknown>): Omit<JobRunRecord, 'error'> {
  return {
    id: String(row.id),
    jobName: String(row.job_name),
    trigger: String(row.trigger) as JobRunRecord['trigger'],
    startedAt: asDate(row.started_at),
    finishedAt: asDate(row.finished_at),
    outcome: String(row.outcome) as JobRunOutcome,
    itemsDue: Number(row.items_due),
    itemsProcessed: Number(row.items_processed),
    itemsFailed: Number(row.items_failed),
    failedItemRefs: Array.isArray(row.failed_item_refs) ? row.failed_item_refs.map(String) : [],
    correlationId: row.correlation_id == null ? null : String(row.correlation_id),
  };
}

/** List-row projection (`getRunHistory` / `listJobStatus`) — `error` truncated. Full stack: `getRun`. */
function mapRow(row: Record<string, unknown>): JobRunRecord {
  return { ...mapRowBase(row), error: truncateError(row.error == null ? null : String(row.error)) };
}

/** Single-run projection (`getRun`) — full, untruncated `error` stack. */
function mapRunDetail(row: Record<string, unknown>): JobRunRecord {
  return { ...mapRowBase(row), error: row.error == null ? null : String(row.error) };
}

function truncateError(error: string | null): string | null {
  if (error == null || error.length <= ERROR_TRUNCATE_LENGTH) return error;
  return `${error.slice(0, ERROR_TRUNCATE_LENGTH)}… (truncated — see GET /jobs/runs/:id for the full stack)`;
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}
