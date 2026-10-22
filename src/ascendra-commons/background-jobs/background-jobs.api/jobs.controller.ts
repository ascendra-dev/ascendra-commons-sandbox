import { Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../authorization/authorization.core';
import type { RunHistoryPage } from '../background-jobs.core';
import { JOB_ACTIONS } from './jobs-api.options';
import { JobsApiService } from './jobs-api.service';

/**
 * api-contract.md Rule 4's cursor-based list shape. The core port's `{ runs, nextCursor }` stays a domain type — the
 * wire shape is this controller's concern. An absent `nextCursor` serializes as `meta: {}`. The dashboard, alerts,
 * summary, volume, failed items and locks are bounded, so they stay bare (Rule 4's bounded case).
 */
async function toCursorList(page: Promise<RunHistoryPage>) {
  const { runs, nextCursor } = await page;
  return { data: runs, meta: { nextCursor } };
}

const optionalNumber = (value?: string) => (value !== undefined ? Number(value) : undefined);

/**
 * The jobs dashboard + run-history reads, and the "run now" / "retry" trigger.
 * Reads gated on `job.view`, the trigger on `job.run`. No tenant scoping — jobs have no `tenantId`. Requires
 * `AuthorizationGuard` wired globally as `APP_GUARD` (see `authorization.core`'s README) — and fails closed without
 * it: `AuthorizationEnforcedGuard` turns a missing global guard into a 500 naming the fix, rather than every
 * signed-in user running jobs.
 *
 * Route order matters: the static `runs/summary` and `runs/volume` are declared before `runs/:id`.
 */
@Controller('jobs')
@UseGuards(AuthorizationEnforcedGuard)
export class JobsController {
  constructor(@Inject(JobsApiService) private readonly service: JobsApiService) {}

  @Get()
  @RequiresAction(JOB_ACTIONS.VIEW)
  dashboard() {
    return this.service.listJobStatus();
  }

  /** The dashboard filtered to jobs needing attention (overdue and/or repeated failures). Read-only — no ack, no webhook. */
  @Get('alerts')
  @RequiresAction(JOB_ACTIONS.VIEW)
  alerts() {
    return this.service.getAlerts();
  }

  /**
   * The Lock Inspector — the lease lock's rows, `held` or `expired` (a holder that died mid-run). `supported: false`
   * when no `JOB_LOCK_INSPECTOR_PORT` is bound (the session-level advisory lock can't be listed).
   */
  @Get('locks')
  @RequiresAction(JOB_ACTIONS.VIEW)
  locks() {
    return this.service.listLocks();
  }

  /** Every job's runs, newest first — `jobName` narrows it to one. */
  @Get('runs')
  @RequiresAction(JOB_ACTIONS.VIEW)
  runs(
    @Query('jobName') jobName?: string,
    @Query('outcome') outcome?: string,
    @Query('trigger') trigger?: string,
    @Query('hasFailedItems') hasFailedItems?: string,
    @Query('correlationId') correlationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('order') order?: string,
  ) {
    return toCursorList(
      this.service.getRunHistory({
        jobName,
        outcome,
        trigger,
        hasFailedItems,
        correlationId,
        since,
        until,
        limit: optionalNumber(limit),
        cursor,
        order,
      }),
    );
  }

  /** The Overview's totals since `since` (everything retained when omitted). */
  @Get('runs/summary')
  @RequiresAction(JOB_ACTIONS.VIEW)
  summary(@Query('since') since?: string) {
    return this.service.runSummary(since);
  }

  /** Per-day runs for 30 calendar days in `tz` (IANA, default UTC), and the table's extent. */
  @Get('runs/volume')
  @RequiresAction(JOB_ACTIONS.VIEW)
  volume(@Query('tz') tz?: string) {
    return this.service.volume(tz);
  }

  @Get('runs/trace/:correlationId')
  @RequiresAction(JOB_ACTIONS.VIEW)
  trace(@Param('correlationId') correlationId: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return toCursorList(this.service.getTrace(correlationId, { limit: optionalNumber(limit), cursor }));
  }

  /** The run-detail permalink — full untruncated `error`, unlike the list rows above. 404 if no such run. */
  @Get('runs/:id')
  @RequiresAction(JOB_ACTIONS.VIEW)
  runDetail(@Param('id') id: string) {
    return this.service.getRun(id);
  }

  /** "Chronic offender" items for one job — see `JobObservabilityPort.getFailedItems`'s doc comment for the best-effort caveat. */
  @Get(':name/failed-items')
  @RequiresAction(JOB_ACTIONS.VIEW)
  failedItems(@Param('name') name: string, @Query('minRuns') minRuns?: string) {
    return this.service.getFailedItems(name, optionalNumber(minRuns));
  }

  /** Runs the job now and waits for it: 200 with the result, 404 for an unknown job, 409 while it's already running. */
  @Post(':name/run')
  @HttpCode(200)
  @RequiresAction(JOB_ACTIONS.RUN)
  run(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
    // Same header (`x-correlation-id`) audit-logging's own CorrelationIdMiddleware reads —
    // reused by convention, not by dependency: this module stays self-contained (no import
    // from audit-logging). The service validates it, and falls back to the app's ambient id.
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.service.trigger(actor, name, correlationId);
  }
}
