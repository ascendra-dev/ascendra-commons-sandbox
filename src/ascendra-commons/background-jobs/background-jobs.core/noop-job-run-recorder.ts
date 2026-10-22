import { Injectable } from '@nestjs/common';
import { JobRunRecorder, JobRunSummary } from './job-run-recorder.port';

/**
 * The default `JobRunRecorder` — records nothing. Bound to `JOB_RUN_RECORDER`
 * by `BackgroundJobsModule.forRoot()` whenever no `jobRunRecorderToken` is
 * supplied, so `IdempotentJobRunner` always has a recorder to call and
 * run-history observability stays strictly opt-in.
 */
@Injectable()
export class NoopJobRunRecorder implements JobRunRecorder {
  async recordRun(_summary: JobRunSummary): Promise<void> {
    // intentionally empty
  }
}
