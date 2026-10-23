import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression, ScheduleModule } from '@nestjs/schedule';
import { AUDIT_EVENT_NAME, AuditRecordRaised, getCurrentCorrelationId } from '../../ascendra-commons/audit-logging/audit-logging.core';
import {
  BackgroundJobsModule,
  IdempotentJobRunner,
  type JobRunTrigger,
  type ScheduledJob,
} from '../../ascendra-commons/background-jobs/background-jobs.core';
import {
  JobRunPrunerJob,
  JobRunPrunerModule,
  POSTGRES_JOB_RUN_RECORDER,
  POSTGRES_LEASE_LOCK,
  PostgresJobObservabilityModule,
  PostgresJobRunRecorderModule,
  PostgresLeaseLockInspectorModule,
  PostgresLeaseLockModule,
} from '../../ascendra-commons/background-jobs/background-jobs.core.postgres-drizzle';
import { JobsApiModule, type JobAuditEmitter, type JobAuditEvent } from '../../ascendra-commons/background-jobs/background-jobs.api';
import { DOMAIN_EVENT_EMITTER, type DomainEventEmitter } from '../../ascendra-commons/domain-events/domain-events.core';
import { DATABASE_CONNECTION, DatabaseModule } from '../../db/database.module';
import {
  DEMO_JOBS,
  DemoJobsModule,
  InvoiceRemindersJob,
  KycExpiryScanJob,
  PayoutSweepJob,
  WebhookRetryJob,
} from '../../demo/demo-jobs';
import { DomainEventRetentionJob, DomainEventRetentionModule, domainEvents } from './domain-events';
import { IdempotencyCleanupJob, IdempotencyCleanupModule } from './idempotency';
import { RateLimitRetentionJob, RateLimitRetentionModule } from './rate-limiting';
import { AccessDenialRetentionJob, AccessDenialRetentionModule } from './authorization';

const application = process.env.APPLICATION ?? 'ascendra-commons-sandbox';

/**
 * Each job's cadence hint — "if it hasn't run in this long, something is wrong" (not its cron; the adapter never sees
 * that). `webhook-retry` declares none, so the dashboard infers one; `ledger-recon` is only declared — no class, no
 * schedule — so it shows as never run. `statement-export` is declared daily but nothing schedules it: overdue.
 */
export const JOB_CADENCES: Record<string, string> = {
  'invoice-reminders': '1h',
  'payout-sweep': '6h',
  'kyc-expiry-scan': '1h',
  'statement-export': '1d',
  'ledger-recon': '6h',
  'job-run-pruner': '1d',
  'rate-limit-retention': '1d',
  'domain-event-retention': '1d',
  'idempotency-cleanup': '1h',
  'access-denial-retention': '1d',
};

/** Run history kept for 90 days — what `JobRunPrunerJob` trims to. */
export const JOB_RUN_RETENTION_DAYS = 90;

const jobRunPruner = JobRunPrunerModule.forRoot({
  sqlExecutorToken: DATABASE_CONNECTION,
  application,
  retentionDays: JOB_RUN_RETENTION_DAYS,
  imports: [DatabaseModule],
});

/**
 * background-jobs, wired the way its README prescribes: the lease lock (a `commons_jobs_lock` row — any pooled
 * connection, and listable, which the Lock Inspector needs), the Postgres run recorder, and every job an admin may run
 * now by name. The modules that provide those jobs are in `imports`.
 */
export const backgroundJobs = BackgroundJobsModule.forRoot({
  advisoryLockToken: POSTGRES_LEASE_LOCK,
  jobRunRecorderToken: POSTGRES_JOB_RUN_RECORDER,
  jobs: [
    ...DEMO_JOBS,
    JobRunPrunerJob,
    RateLimitRetentionJob,
    DomainEventRetentionJob,
    IdempotencyCleanupJob,
    AccessDenialRetentionJob,
  ],
  imports: [
    PostgresLeaseLockModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] }),
    PostgresJobRunRecorderModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] }),
    DemoJobsModule,
    jobRunPruner,
    RateLimitRetentionModule,
    DomainEventRetentionModule,
    IdempotencyCleanupModule,
    AccessDenialRetentionModule,
  ],
});

/** A manual run, recorded in audit-logging as `job · triggered` — through domain-events, as every audit record is. */
@Injectable()
class AuditJobEmitter implements JobAuditEmitter {
  constructor(@Inject(DOMAIN_EVENT_EMITTER) private readonly events: DomainEventEmitter) {}

  record(event: JobAuditEvent): Promise<void> {
    return this.events.emitCritical(
      AUDIT_EVENT_NAME,
      new AuditRecordRaised({
        entityType: 'job',
        entityId: event.jobName,
        tenantId: null,
        actor: event.actorId,
        action: 'triggered',
        after: { result: event.result },
        occurredAt: new Date(),
      }),
    );
  }
}

@Module({ imports: [domainEvents], providers: [AuditJobEmitter], exports: [AuditJobEmitter] })
class AuditJobEmitterModule {}

/**
 * The read endpoints and the trigger (`/jobs/*` — `job.view`, `job.run`). A manual run without an `X-Correlation-Id`
 * takes the request's own id (audit-logging's), so it traces with its `job · triggered` audit record.
 */
export const backgroundJobsApi = JobsApiModule.forRoot({
  auditEmitterToken: AuditJobEmitter,
  correlationIdResolver: getCurrentCorrelationId,
  imports: [
    PostgresJobObservabilityModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION,
      application,
      cadences: JOB_CADENCES,
      imports: [DatabaseModule],
    }),
    PostgresLeaseLockInspectorModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] }),
    backgroundJobs,
    AuditJobEmitterModule,
  ],
});

/**
 * The schedule — the vertical's part (background-jobs ships no scheduler): a thin `@Cron` per job around the shared
 * runner. The retention jobs also run once at boot (`trigger: 'bootstrap'`), catching up a prune a restart skipped.
 * Every running copy of the API (and the seed / simulate CLIs) fires these; the lease lock lets one run each time.
 */
@Injectable()
class JobSchedules implements OnApplicationBootstrap {
  private readonly logger = new Logger('JobSchedules');

  constructor(
    @Inject(IdempotentJobRunner) private readonly runner: IdempotentJobRunner,
    @Inject(InvoiceRemindersJob) private readonly invoiceReminders: InvoiceRemindersJob,
    @Inject(PayoutSweepJob) private readonly payoutSweep: PayoutSweepJob,
    @Inject(KycExpiryScanJob) private readonly kycExpiryScan: KycExpiryScanJob,
    @Inject(WebhookRetryJob) private readonly webhookRetry: WebhookRetryJob,
    @Inject(JobRunPrunerJob) private readonly jobRunPruner: JobRunPrunerJob,
    @Inject(RateLimitRetentionJob) private readonly rateLimitRetention: RateLimitRetentionJob,
    @Inject(DomainEventRetentionJob) private readonly domainEventRetention: DomainEventRetentionJob,
    @Inject(IdempotencyCleanupJob) private readonly idempotencyCleanup: IdempotencyCleanupJob,
    @Inject(AccessDenialRetentionJob) private readonly accessDenialRetention: AccessDenialRetentionJob,
  ) {}

  onApplicationBootstrap() {
    for (const job of [this.jobRunPruner, this.rateLimitRetention, this.domainEventRetention, this.idempotencyCleanup, this.accessDenialRetention]) {
      void this.run(job, 'bootstrap');
    }
  }

  @Cron(CronExpression.EVERY_HOUR) invoiceRemindersRun() { return this.run(this.invoiceReminders); }
  @Cron('5 */6 * * *') payoutSweepRun() { return this.run(this.payoutSweep); }
  @Cron('30 * * * *') kycExpiryScanRun() { return this.run(this.kycExpiryScan); }
  @Cron('*/15 * * * *') webhookRetryRun() { return this.run(this.webhookRetry); }
  @Cron('10 3 * * *') jobRunPrunerRun() { return this.run(this.jobRunPruner); }
  @Cron('20 3 * * *') rateLimitRetentionRun() { return this.run(this.rateLimitRetention); }
  @Cron('25 3 * * *') domainEventRetentionRun() { return this.run(this.domainEventRetention); }
  @Cron('45 * * * *') idempotencyCleanupRun() { return this.run(this.idempotencyCleanup); }
  @Cron('30 3 * * *') accessDenialRetentionRun() { return this.run(this.accessDenialRetention); }

  /** A job-level failure rejects `run()` (it's recorded first) — logged here, so a broken job never crashes the scheduler. */
  private async run(job: ScheduledJob<unknown>, trigger: JobRunTrigger = 'scheduled') {
    try {
      await this.runner.run(job, { trigger });
    } catch (err) {
      this.logger.warn(`Job "${job.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

@Module({
  imports: [ScheduleModule.forRoot(), backgroundJobs, DemoJobsModule, jobRunPruner, RateLimitRetentionModule, DomainEventRetentionModule, IdempotencyCleanupModule, AccessDenialRetentionModule],
  providers: [JobSchedules],
})
export class JobSchedulesModule {}
