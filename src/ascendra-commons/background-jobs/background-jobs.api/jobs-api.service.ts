import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';
import {
  InvalidJobRunCursorError,
  isValidTimeZone,
  JOB_LOCK_INSPECTOR_PORT,
  JOB_OBSERVABILITY_PORT,
  JobTrigger,
  type FailedItemSummary,
  type JobLockInspectorPort,
  type JobLockView,
  type JobObservabilityPort,
  type JobRunRecord,
  type JobStatus,
  type JobTriggerResult,
  type RunHistoryPage,
  type RunSummary,
  type RunVolume,
} from '../background-jobs.core';
import { JOB_AUDIT_EMITTER, JOB_CORRELATION_ID_RESOLVER } from './tokens';
import type { JobAuditEmitter } from './job-audit.port';
import type { RunHistoryQueryDto } from './dto/jobs-api.dto';

/**
 * A job on the dashboard is surfaced as an alert once it's overdue, or once it
 * has this many (or more) consecutive failed runs. A pure filter over
 * `listJobStatus()` — no new persistence, no ack state (deferred; see
 * `mocks.html`).
 */
const ALERT_CONSECUTIVE_FAILURES_THRESHOLD = 2;

/**
 * A correlation id worth storing on a run — a header is the caller's text. Same rule as `audit-logging`,
 * `rate-limiting` and `domain-events`, duplicated so each module stays copyable.
 */
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const wellFormed = (id: unknown): id is string => typeof id === 'string' && CORRELATION_ID.test(id);

const OUTCOMES = ['completed', 'job_failed'] as const;
const TRIGGERS = ['scheduled', 'bootstrap', 'manual'] as const;
const ORDERS = ['asc', 'desc'] as const;
const BOOLEANS = ['true', 'false'] as const;

/** The Lock Inspector — `supported: false` when the app's lock can't be listed (the session-level advisory lock). */
export interface JobLocksView {
  supported: boolean;
  locks: JobLockView[];
}

/** One dashboard row, plus whether `POST /jobs/:name/run` can run it (it's in `BackgroundJobsModule.forRoot({ jobs })`). */
export type JobStatusView = JobStatus & { triggerable: boolean };

/**
 * A date query param as a Date — a 400 when it isn't one. Unchecked, `new Date('yesterday')` is an Invalid Date that
 * only fails when the driver serializes it: a 500 for what is the caller's mistake.
 */
function dateParam(name: string, value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`"${name}" must be an ISO 8601 date or date-time`);
  return date;
}

/** A positive whole number as given — a 400 otherwise (`?limit=abc` arrives as NaN). Adapters cap it. */
function positiveIntParam(name: string, value: number | undefined): number | undefined {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new BadRequestException(`"${name}" must be a positive whole number`);
  }
  return value;
}

/**
 * A text param as given — a 400 if it holds a NUL byte, which Postgres can't store in `text` and rejects as an
 * encoding error: a 500 for a malformed name.
 */
function textParam(name: string, value: string | undefined): string | undefined {
  if (value?.includes('\u0000')) throw new BadRequestException(`"${name}" must not contain a NUL byte`);
  return value;
}

/** One of `allowed`, or a 400 — an unknown value would match nothing and read as "none". */
function enumParam<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value !== undefined && !(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException(`"${name}" must be one of ${allowed.join(', ')}`);
  }
  return value as T | undefined;
}

/**
 * Thin orchestration over `JobObservabilityPort` (reads) and `JobTrigger` (the
 * one action). No tenant scoping — `background-jobs` has no `tenantId`. Params
 * are validated here — a bad date, number, enum, time zone or cursor, or a NUL
 * byte in any text, is a 400, never a 500; a missing run or unknown job is a 404.
 * The manual trigger emits an audit event through the optional emitter.
 */
@Injectable()
export class JobsApiService {
  constructor(
    @Inject(JOB_OBSERVABILITY_PORT) private readonly observability: JobObservabilityPort,
    @Inject(JobTrigger) private readonly jobTrigger: JobTrigger,
    @Inject(JOB_AUDIT_EMITTER) private readonly audit: JobAuditEmitter,
    @Optional() @Inject(JOB_LOCK_INSPECTOR_PORT) private readonly lockInspector?: JobLockInspectorPort,
    @Optional() @Inject(JOB_CORRELATION_ID_RESOLVER) private readonly correlationIdResolver?: () => string | undefined,
  ) {}

  /**
   * The dashboard: every job that has run or declares a cadence, plus every job the app registered for "run now"
   * that has done neither yet — each flagged with whether it can be triggered.
   */
  async listJobStatus(): Promise<JobStatusView[]> {
    const statuses = await this.observability.listJobStatus();
    const triggerable = new Set(this.jobTrigger.availableJobs());
    const seen = new Set(statuses.map((s) => s.name));
    const unseen: JobStatus[] = [...triggerable]
      .filter((name) => !seen.has(name))
      .map((name) => ({ name, lastRun: null, lastSuccessAt: null, consecutiveFailures: 0, cadence: null, overdue: false, overdueBy: null }));
    return [...statuses, ...unseen]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ ...s, triggerable: triggerable.has(s.name) }));
  }

  async getRunHistory(query: RunHistoryQueryDto): Promise<RunHistoryPage> {
    const hasFailedItems = enumParam('hasFailedItems', query.hasFailedItems, BOOLEANS);
    try {
      return await this.observability.getRunHistory({
        jobName: textParam('jobName', query.jobName),
        outcome: enumParam('outcome', query.outcome, OUTCOMES),
        trigger: enumParam('trigger', query.trigger, TRIGGERS),
        hasFailedItems: hasFailedItems === undefined ? undefined : hasFailedItems === 'true',
        correlationId: textParam('correlationId', query.correlationId),
        since: dateParam('since', query.since),
        until: dateParam('until', query.until),
        limit: positiveIntParam('limit', query.limit),
        cursor: query.cursor,
        order: enumParam('order', query.order, ORDERS),
      });
    } catch (err) {
      if (err instanceof InvalidJobRunCursorError) {
        throw new BadRequestException('"cursor" is not one this endpoint returned — start again without it');
      }
      throw err;
    }
  }

  /** A request / job timeline reads top to bottom — always ascending, whatever the caller's `order`. */
  getTrace(correlationId: string, query: RunHistoryQueryDto): Promise<RunHistoryPage> {
    return this.getRunHistory({ ...query, correlationId, order: 'asc' });
  }

  runSummary(since?: string): Promise<RunSummary> {
    return this.observability.runSummary({ since: dateParam('since', since) });
  }

  volume(tz?: string): Promise<RunVolume> {
    if (tz !== undefined && !isValidTimeZone(tz)) throw new BadRequestException(`Unknown time zone "${tz}"`);
    return this.observability.volume(tz);
  }

  /**
   * Runs the job now and waits for it. An unknown job is a 404 and a job already running a 409 — neither is a run, so
   * neither is recorded; a `job_failed` result is a 200 (the run happened, and is in the history). Every attempt is
   * audited, refused ones included.
   *
   * @param headerCorrelationId  the inbound `X-Correlation-Id`, as sent. The run is tagged for `getTrace()` with it
   *   when well-formed, else with the app's ambient id (`correlationIdResolver`), else a fresh one — every manual run
   *   is traceable.
   */
  async trigger(actor: Actor, jobName: string, headerCorrelationId?: string): Promise<JobTriggerResult> {
    textParam('name', jobName);
    const correlationId = wellFormed(headerCorrelationId) ? headerCorrelationId : (this.ambientCorrelationId() ?? randomUUID());
    const result = await this.jobTrigger.trigger(jobName, correlationId);
    await this.audit.record({ action: 'job.triggered', actorId: actor.id, jobName, result: result.status });
    if (result.status === 'unknown_job') throw new NotFoundException(`No job "${jobName}" can be run — it isn't registered for triggering`);
    if (result.status === 'already_running') throw new ConflictException(`Job "${jobName}" is already running — try again when it finishes`);
    return result;
  }

  private ambientCorrelationId(): string | undefined {
    try {
      const id = this.correlationIdResolver?.();
      return wellFormed(id) ? id : undefined;
    } catch {
      return undefined;
    }
  }

  async getRun(id: string): Promise<JobRunRecord> {
    textParam('id', id);
    const run = await this.observability.getRun(id);
    if (!run) throw new NotFoundException(`No run "${id}"`);
    return run;
  }

  getFailedItems(jobName: string, minRuns?: number): Promise<FailedItemSummary[]> {
    textParam('name', jobName);
    return this.observability.getFailedItems(jobName, positiveIntParam('minRuns', minRuns));
  }

  /** Which job locks are held now, and which a dead holder left behind. Read-only — no force-release. */
  async listLocks(): Promise<JobLocksView> {
    if (!this.lockInspector) return { supported: false, locks: [] };
    return { supported: true, locks: await this.lockInspector.listLocks() };
  }

  /** The dashboard, filtered to jobs that need an operator's attention. Read-only — no ack state, no webhook (deferred). */
  async getAlerts(): Promise<JobStatusView[]> {
    const statuses = await this.listJobStatus();
    return statuses.filter((s) => s.overdue || s.consecutiveFailures >= ALERT_CONSECUTIVE_FAILURES_THRESHOLD);
  }
}
