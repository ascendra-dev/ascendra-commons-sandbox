import { Injectable, Module } from '@nestjs/common';
import type { ScheduledJob } from '../ascendra-commons/background-jobs/background-jobs.core';

/**
 * Sandbox-only scheduled jobs for the background-jobs screens. The sandbox has no product tables, so each job's "due
 * items" are synthetic — but every run goes through the real `IdempotentJobRunner` (the lease lock, per-item failure
 * isolation, the run recorder). Each job is here for one case on the dashboard:
 *
 * | Job                 | Schedule (src/modules/commons/background-jobs.ts) | Case                                                  |
 * |---------------------|---------------------------------------------------|-------------------------------------------------------|
 * | `invoice-reminders` | hourly                                            | healthy — clean every run                             |
 * | `payout-sweep`      | every 6 hours                                     | one payout fails every run (a chronic failed item), others now and then |
 * | `kyc-expiry-scan`   | hourly                                            | broken — `findDueItems()` throws: job failures in a row |
 * | `webhook-retry`     | every 15 minutes, no declared cadence             | the cadence is inferred from its runs                 |
 * | `statement-export`  | not scheduled (its cron "went missing in a deploy") | overdue; a dead holder's lock left on it (the seed) — Run now recovers both |
 * | `search-reindex`    | manual only, ~15s                                 | a run long enough to see its lock held, and a 409     |
 *
 * A seventh, `ledger-recon`, has only a declared cadence — no class at all — so it's "never run" and can't be triggered.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const id = (prefix: string) => `${prefix}_${Math.random().toString(16).slice(2, 6)}`;
const between = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

interface DemoItem {
  id: string;
  /** Why processing it fails, if it does. */
  failure?: string;
}

/** Shared shape: a batch of synthetic items, each "processed" in a few ms, or failing with its reason. */
abstract class DemoJob implements ScheduledJob<DemoItem> {
  abstract readonly name: string;
  protected abstract readonly itemLabel: string;
  protected abstract dueItems(): DemoItem[];

  async findDueItems(): Promise<DemoItem[]> {
    return this.dueItems();
  }

  async processItem(item: DemoItem): Promise<void> {
    await sleep(between(2, 15));
    if (item.failure) throw new Error(item.failure);
  }

  describeItem(item: DemoItem): string {
    return item.failure ? `${this.itemLabel} ${item.id} — ${item.failure}` : `${this.itemLabel} ${item.id}`;
  }
}

/** Healthy: a few invoices due a reminder, every one sent. */
@Injectable()
export class InvoiceRemindersJob extends DemoJob {
  readonly name = 'invoice-reminders';
  protected readonly itemLabel = 'invoice';
  protected dueItems(): DemoItem[] {
    return Array.from({ length: between(0, 8) }, () => ({ id: id('inv') }));
  }
}

/** The payout `p_9c04` is always due and always fails — its settlement account is short. Now and then a provider timeout too. */
@Injectable()
export class PayoutSweepJob extends DemoJob {
  readonly name = 'payout-sweep';
  protected readonly itemLabel = 'payout';
  protected dueItems(): DemoItem[] {
    const others = Array.from({ length: between(2, 12) }, () => ({
      id: id('p'),
      failure: Math.random() < 0.1 ? 'provider timeout' : undefined,
    }));
    // Its ref ("payout p_9c04 — insufficient float …") is the same every run, so the failed-items view matches it.
    return [{ id: 'p_9c04', failure: 'insufficient float in settlement account' }, ...others];
  }
}

/** Broken: the query for due items throws — a job-level failure, nothing processed, every run. */
@Injectable()
export class KycExpiryScanJob implements ScheduledJob<never> {
  readonly name = 'kyc-expiry-scan';
  async findDueItems(): Promise<never[]> {
    await sleep(between(20, 60));
    throw new Error('connection pool exhausted — timeout acquiring a client after 5000ms');
  }
  async processItem(): Promise<void> {}
}

/** No declared cadence: the dashboard infers one (the median gap of its scheduled runs). */
@Injectable()
export class WebhookRetryJob extends DemoJob {
  readonly name = 'webhook-retry';
  protected readonly itemLabel = 'webhook delivery';
  protected dueItems(): DemoItem[] {
    return Array.from({ length: between(0, 5) }, () => ({
      id: id('wh'),
      failure: Math.random() < 0.05 ? 'endpoint answered 502' : undefined,
    }));
  }
}

/** Overdue: declared daily, but nothing schedules it any more. Triggerable, so Run now catches it up. */
@Injectable()
export class StatementExportJob extends DemoJob {
  readonly name = 'statement-export';
  protected readonly itemLabel = 'statement';
  protected dueItems(): DemoItem[] {
    return Array.from({ length: between(3, 9) }, () => ({ id: id('st') }));
  }
}

/** Manual only, and slow (~1s an item) — long enough to see its lock held on the Locks screen, and a second Run now get a 409. */
@Injectable()
export class SearchReindexJob extends DemoJob {
  readonly name = 'search-reindex';
  protected readonly itemLabel = 'index shard';
  protected dueItems(): DemoItem[] {
    return Array.from({ length: 15 }, (_, i) => ({ id: `shard-${i + 1}` }));
  }
  override async processItem(item: DemoItem): Promise<void> {
    await sleep(1000);
    if (item.failure) throw new Error(item.failure);
  }
}

export const DEMO_JOBS = [
  InvoiceRemindersJob,
  PayoutSweepJob,
  KycExpiryScanJob,
  WebhookRetryJob,
  StatementExportJob,
  SearchReindexJob,
] as const;

@Module({ providers: [...DEMO_JOBS], exports: [...DEMO_JOBS] })
export class DemoJobsModule {}
