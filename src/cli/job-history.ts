import { sql } from 'drizzle-orm';
import type { JobRunRecorder, JobRunSummary, JobRunTrigger } from '../ascendra-commons/background-jobs/background-jobs.core';
import type { Database } from '../db/database.module';
import type { Rng } from './rng';

/**
 * Generates background-jobs run history. Two halves, because a run's time can't be set through the runner:
 *
 * 1. **The past** — `IdempotentJobRunner` stamps `startedAt` with the real clock, so 90 days of history can't be run.
 *    Each past fire of each job's schedule (src/modules/commons/background-jobs.ts) is written through the module's own
 *    write entry point instead, the real `PostgresJobRunRecorder` — the summary the runner would have produced for
 *    that job's case in src/demo/demo-jobs.ts. Every screen counts by `startedAt`, so this is what they show.
 * 2. **Now** — real runs over HTTP, `POST /jobs/:name/run` as the platform admin: manual runs through the real runner,
 *    each with a correlation id that also lands on its `job · triggered` audit record.
 *
 * Plus one thing no entry point makes: a lease a dead process left behind (the Lock Inspector's "expired" row),
 * written as the row `PostgresLeaseLock` would have left.
 *
 * The story, by job: `kyc-expiry-scan` broke 5 days ago (its due-items query times out every run since);
 * `payout-sweep` has carried one failing payout for 12 days; `statement-export` ran daily until 3 days ago, its next
 * run died holding the lock, and nothing has scheduled it since (overdue). The rest are healthy.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface JobHistoryOptions {
  days: number;
  /** History ends here (real now). */
  until: Date;
}

export interface JobHistoryTotals {
  recorded: number;
  manual: number;
}

const KYC_ERROR = `Error: connection pool exhausted — timeout acquiring a client after 5000ms
    at Pool.connect (node_modules/pg-pool/index.js:45:11)
    at KycExpiryScanJob.findDueItems (src/demo/demo-jobs.ts:88:5)
    at IdempotentJobRunner.run (src/ascendra-commons/background-jobs/background-jobs.core/idempotent-job-runner.service.ts:79:23)`;

/** One job's schedule in the past: when it fired, and what one run of it looked like. */
interface Profile {
  name: string;
  /** Every fire time in [from, until). */
  fires(from: number, until: number): number[];
  run(at: number): Omit<JobRunSummary, 'jobName' | 'startedAt' | 'finishedAt' | 'trigger'> & { durationMs: number };
}

export class JobHistory {
  private readonly totals: JobHistoryTotals = { recorded: 0, manual: 0 };

  constructor(
    private readonly recorder: JobRunRecorder,
    private readonly db: Database,
    private readonly rng: Rng,
  ) {}

  async run(options: JobHistoryOptions, baseUrl: string): Promise<JobHistoryTotals> {
    const until = options.until.getTime();
    const from = until - options.days * DAY;
    const kycBrokeAt = until - 5 * DAY;
    const p9c04DueSince = until - 12 * DAY;
    const statementStoppedAt = until - 3 * DAY;

    const clean = (min: number, max: number, msPerItem: number) => () => {
      const due = this.rng.int(min, max);
      return { outcome: 'completed' as const, itemsDue: due, itemsProcessed: due, itemsFailed: 0, failedItemRefs: [], durationMs: 40 + due * msPerItem };
    };
    const one = () => ({ outcome: 'completed' as const, itemsDue: 1, itemsProcessed: 1, itemsFailed: 0, failedItemRefs: [], durationMs: this.rng.int(20, 900) });

    const profiles: Profile[] = [
      { name: 'invoice-reminders', fires: every(HOUR, 0), run: clean(0, 8, 120) },
      {
        name: 'payout-sweep',
        fires: every(6 * HOUR, 5 * MINUTE),
        run: (at) => {
          const refs: string[] = [];
          if (at >= p9c04DueSince) refs.push('payout p_9c04 — insufficient float in settlement account');
          const others = this.rng.int(2, 12);
          for (let i = 0; i < others; i++) {
            if (this.rng.chance(0.1)) refs.push(`payout p_${this.rng.uuid().slice(0, 4)} — provider timeout`);
          }
          const due = others + (at >= p9c04DueSince ? 1 : 0);
          return { outcome: 'completed', itemsDue: due, itemsProcessed: due - refs.length, itemsFailed: refs.length, failedItemRefs: refs, durationMs: 800 + due * 2_100 };
        },
      },
      {
        name: 'kyc-expiry-scan',
        fires: every(HOUR, 30 * MINUTE),
        run: (at) =>
          at >= kycBrokeAt
            ? { outcome: 'job_failed', itemsDue: 0, itemsProcessed: 0, itemsFailed: 0, failedItemRefs: [], error: KYC_ERROR, durationMs: 5_000 + this.rng.int(0, 80) }
            : clean(0, 20, 60)(),
      },
      {
        name: 'webhook-retry',
        fires: every(15 * MINUTE, 0),
        run: () => {
          const due = this.rng.int(0, 5);
          const refs = Array.from({ length: due }, () => `webhook delivery wh_${this.rng.uuid().slice(0, 4)} — endpoint answered 502`).filter(() => this.rng.chance(0.05));
          return { outcome: 'completed', itemsDue: due, itemsProcessed: due - refs.length, itemsFailed: refs.length, failedItemRefs: refs, durationMs: 30 + due * 400 };
        },
      },
      { name: 'statement-export', fires: (a, b) => every(DAY, 2 * HOUR)(a, Math.min(b, statementStoppedAt)), run: clean(3, 9, 1_500) },
      { name: 'job-run-pruner', fires: every(DAY, 3 * HOUR + 10 * MINUTE), run: one },
      { name: 'rate-limit-retention', fires: every(DAY, 3 * HOUR + 20 * MINUTE), run: one },
      { name: 'domain-event-retention', fires: every(DAY, 3 * HOUR + 25 * MINUTE), run: one },
      { name: 'idempotency-cleanup', fires: every(HOUR, 45 * MINUTE), run: one },
    ];

    const runs: JobRunSummary[] = [];
    for (const profile of profiles) {
      for (const at of profile.fires(from, until)) runs.push(this.summary(profile, at, 'scheduled'));
    }
    // A deploy every week or so — each boot catches the retention jobs up (`trigger: 'bootstrap'`).
    for (let at = from + this.rng.int(2, 6) * DAY; at < until - DAY; at += this.rng.int(5, 9) * DAY) {
      const boot = at + this.rng.int(9 * 60, 17 * 60) * MINUTE;
      for (const name of ['job-run-pruner', 'rate-limit-retention', 'domain-event-retention', 'idempotency-cleanup']) {
        runs.push(this.summary(profiles.find((p) => p.name === name)!, boot + this.rng.int(0, 900), 'bootstrap'));
      }
    }
    // An operator re-ran the payout sweep by hand now and then.
    for (let i = 0; i < 6; i++) {
      const at = until - this.rng.int(1, options.days - 1) * DAY - this.rng.int(0, 12) * HOUR;
      runs.push({ ...this.summary(profiles[1], at, 'manual'), correlationId: this.rng.uuid() });
    }

    // Through the real recorder, a few at a time (one INSERT each).
    for (let i = 0; i < runs.length; i += 25) {
      await Promise.all(runs.slice(i, i + 25).map((run) => this.recorder.recordRun(run)));
    }
    this.totals.recorded = runs.length;

    // The run that died: statement-export's fire the day after its last recorded run took the lease and never released
    // it. PostgresLeaseLock deletes its row on release, so a row past its lease is exactly what a crash leaves.
    const diedAt = every(DAY, 2 * HOUR)(statementStoppedAt, statementStoppedAt + DAY)[0];
    await this.db.execute(sql`
      insert into commons_jobs_lock (application, lock_key, holder, acquired_at, locked_until)
      values (${process.env.APPLICATION ?? 'ascendra-commons-sandbox'}, 'scheduler:statement-export', 'sandbox-api-7f2a#4242#d1ed0b4c',
              ${new Date(diedAt)}, ${new Date(diedAt + 15 * MINUTE)})
      on conflict (application, lock_key) do nothing
    `);

    await this.manualRuns(baseUrl);
    return this.totals;
  }

  /** Real runs now, through the API — each audited, each traceable by the correlation id it was sent with. */
  private async manualRuns(baseUrl: string): Promise<void> {
    const res = await fetch(`${baseUrl}/dev/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorId: 'platform.admin@ascendra.test' }),
    });
    const { token } = (await res.json()) as { token: string };
    for (const name of ['invoice-reminders', 'payout-sweep', 'kyc-expiry-scan', 'webhook-retry']) {
      const run = await fetch(`${baseUrl}/jobs/${name}/run`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'x-correlation-id': this.rng.uuid() },
      });
      if (run.status !== 200) throw new Error(`POST /jobs/${name}/run answered ${run.status}`);
      this.totals.manual += 1;
    }
  }

  private summary(profile: Profile, at: number, trigger: JobRunTrigger): JobRunSummary {
    const { durationMs, ...rest } = profile.run(at);
    const startedAt = new Date(at + this.rng.int(0, 2_500));
    return { jobName: profile.name, trigger, startedAt, finishedAt: new Date(startedAt.getTime() + durationMs), ...rest };
  }
}

/** Fire times of a fixed-interval schedule (UTC, aligned to midnight + offset) within [from, until). */
function every(interval: number, offset: number) {
  return (from: number, until: number): number[] => {
    const midnight = Math.floor(from / DAY) * DAY;
    const out: number[] = [];
    for (let at = midnight + offset; at < until; at += interval) if (at >= from) out.push(at);
    return out;
  };
}
