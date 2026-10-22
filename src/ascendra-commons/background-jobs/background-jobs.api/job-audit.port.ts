import { Injectable } from '@nestjs/common';

/**
 * Where `background-jobs.api` sends an audit record after a manual trigger. A
 * manual job run is a privileged operation; if the vertical binds
 * `JOB_AUDIT_EMITTER` (e.g. to an adapter over `audit-logging`), each
 * `POST /jobs/:name/run` is recorded. No-op if unbound; no hard dep on
 * `audit-logging`.
 */
export interface JobAuditEvent {
  /** `'job.triggered'`. */
  action: string;
  actorId: string;
  /** The job name. */
  jobName: string;
  /** The `JobTriggerResult` status. */
  result: string;
}

export interface JobAuditEmitter {
  record(event: JobAuditEvent): Promise<void> | void;
}

/** The default binding — audit is opt-in. */
@Injectable()
export class NoopJobAuditEmitter implements JobAuditEmitter {
  record(): void {
    /* no-op */
  }
}
