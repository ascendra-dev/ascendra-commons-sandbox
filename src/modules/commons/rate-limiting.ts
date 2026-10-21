import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
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
 * Retention is the consumer's (the module never prunes on its own). The sandbox has no scheduler yet, so this stands
 * in for one: prune at boot, then daily. A product runs `pruneRejections()` from its own scheduler — a background-jobs
 * `ScheduledJob` once that module is here.
 */
@Injectable()
class RateLimitRetentionTask implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('RateLimitRetention');
  private timer?: NodeJS.Timeout;

  constructor(@Inject(PostgresRateLimitRetentionService) private readonly retention: PostgresRateLimitRetentionService) {}

  onApplicationBootstrap() {
    void this.prune();
    this.timer = setInterval(() => void this.prune(), DAY);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private async prune() {
    try {
      const pruned = await this.retention.pruneRejections(new Date(Date.now() - RETENTION_DAYS * DAY));
      if (pruned > 0) this.logger.log(`Pruned ${pruned} rate-limit rejection window(s) older than ${RETENTION_DAYS} days`);
    } catch (err) {
      this.logger.error('Rate-limit retention failed', err instanceof Error ? err.stack : String(err));
    }
  }
}

@Module({
  imports: [PostgresRateLimitRetentionModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] })],
  providers: [RateLimitRetentionTask],
})
export class RateLimitRetentionModule {}
