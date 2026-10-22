import { Injectable } from '@nestjs/common';
import { ScheduledJob } from './scheduled-job.port';

/**
 * Name → `ScheduledJob` instance, for the one thing a `@Cron` wiring class
 * can't do: resolve a job from a string an HTTP request carried. Populated by
 * `BackgroundJobsModule.forRoot({ jobs: [...] })` — a job absent from that list
 * still runs on its schedule, it just can't be triggered on demand.
 *
 * A `ScheduledJob`'s `name` is also its advisory lock key, so two jobs sharing
 * one name is already a latent bug (an uncoordinated second lock). Registering
 * them both here surfaces it as a startup error instead.
 */
@Injectable()
export class ScheduledJobRegistry {
  private readonly byName = new Map<string, ScheduledJob<unknown>>();

  constructor(jobs: ReadonlyArray<ScheduledJob<unknown>>) {
    for (const job of jobs) {
      if (this.byName.has(job.name)) {
        throw new Error(
          `Two scheduled jobs are registered under the name "${job.name}" — a job name must be unique (it is also the advisory lock key).`,
        );
      }
      this.byName.set(job.name, job);
    }
  }

  get(name: string): ScheduledJob<unknown> | undefined {
    return this.byName.get(name);
  }

  /** Every triggerable job name — e.g. for an admin screen's job picker. */
  names(): string[] {
    return [...this.byName.keys()];
  }
}
