import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import type { ScheduledJob } from '../../ascendra-commons/background-jobs/background-jobs.core';
import { ThrottlerModule } from '@nestjs/throttler';
import { RateLimitingThrottlerModule } from '../../ascendra-commons/rate-limiting/rate-limiting.core.throttler';
import {
  POSTGRES_RATE_LIMIT_EVENT_RECORDER,
  PostgresRateLimitEventRecorderModule,
  PostgresRateLimitObservabilityModule,
  PostgresRateLimitRetentionModule,
  PostgresRateLimitRetentionService,
} from '../../ascendra-commons/rate-limiting/rate-limiting.core.postgres-drizzle';
import { RateLimitingApiModule } from '../../ascendra-commons/rate-limiting/rate-limiting.api';
import { DATABASE_CONNECTION, DatabaseModule } from '../../db/database.module';

const application = process.env.APPLICATION ?? 'ascendra-commons-sandbox';

/**
 * The limits themselves — `@nestjs/throttler`'s own module, a project decision. One generous ceiling on every route
 * (per caller IP); the demo routes (src/demo) declare tighter ones with `@Throttle()`.
 */
export const throttler = ThrottlerModule.forRoot({ throttlers: [{ name: 'default', limit: 600, ttl: 60_000 }] });

/**
 * rate-limiting, wired the way its README prescribes: `RecordingThrottlerGuard` (registered as the first global guard
 * in src/auth) reports every 429 to the Postgres recorder, which counts in memory and upserts rejection windows.
 * `maxBufferedKeys` is deliberately tiny here so the seed's distributed flood shows an `(overflow)` row — a product
 * keeps the default (10,000).
 */
export const rateLimiting = RateLimitingThrottlerModule.forRoot({
  recorderToken: POSTGRES_RATE_LIMIT_EVENT_RECORDER,
  imports: [
    PostgresRateLimitEventRecorderModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION,
      application,
      maxBufferedKeys: 100,
      imports: [DatabaseModule],
    }),
  ],
});

/** The read endpoints (`/rate-limits/*`, gated by `rate-limit.view`) over the Postgres reader. */
export const rateLimitingApi = RateLimitingApiModule.forRoot({
  imports: [PostgresRateLimitObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] })],
});

const RETENTION_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Retention is the consumer's (the module never prunes on its own): a background-jobs `ScheduledJob`, scheduled daily
 * (and at boot) in background-jobs.ts — so each prune is a run on the jobs screens. One item, the cutoff.
 */
@Injectable()
export class RateLimitRetentionJob implements ScheduledJob<Date> {
  readonly name = 'rate-limit-retention';
  private readonly logger = new Logger('RateLimitRetention');

  constructor(@Inject(PostgresRateLimitRetentionService) private readonly retention: PostgresRateLimitRetentionService) {}

  async findDueItems(): Promise<Date[]> {
    return [new Date(Date.now() - RETENTION_DAYS * DAY)];
  }

  async processItem(cutoff: Date): Promise<void> {
    const pruned = await this.retention.pruneRejections(cutoff);
    if (pruned > 0) this.logger.log(`Pruned ${pruned} rate-limit rejection window(s) older than ${RETENTION_DAYS} days`);
  }

  describeItem(cutoff: Date): string {
    return `rejection windows before ${cutoff.toISOString()}`;
  }
}

@Module({
  imports: [PostgresRateLimitRetentionModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] })],
  providers: [RateLimitRetentionJob],
  exports: [RateLimitRetentionJob],
})
export class RateLimitRetentionModule {}
