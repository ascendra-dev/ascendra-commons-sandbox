import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { IdempotencyModule } from '../../ascendra-commons/idempotency-key/idempotency-key.core';
import {
  POSTGRES_IDEMPOTENCY_STORE,
  PostgresIdempotencyObservabilityModule,
  PostgresIdempotencyStoreModule,
} from '../../ascendra-commons/idempotency-key/idempotency-key.core.postgres-drizzle';
import { IdempotencyApiModule } from '../../ascendra-commons/idempotency-key/idempotency-key.api';
import { DATABASE_CONNECTION, DatabaseModule, type Database } from '../../db/database.module';

/**
 * How long a claim may sit in progress before a retry may take it over. A product measures its slowest idempotent
 * endpoint's real p99 and sets this above it (the module's README). The sandbox sets it low on purpose, so its
 * generator can show a request taken over while still running — the "ran twice" case — in a few seconds.
 */
export const IDEMPOTENCY_STALE_AFTER_SECONDS = 5;

/**
 * idempotency-key, wired the way its README prescribes: the Postgres store (which also counts replays and 409s in
 * memory) behind `IdempotencyInterceptor`, which an endpoint opts into with `@UseInterceptors()` — here the demo
 * routes (src/demo). Scope is `ActorScopeResolver`'s default: the signed-in actor's tenant (or the actor, platform-side).
 */
export const idempotency = IdempotencyModule.forRoot({
  storeToken: POSTGRES_IDEMPOTENCY_STORE,
  imports: [
    PostgresIdempotencyStoreModule.forRoot({
      sqlExecutorToken: DATABASE_CONNECTION,
      staleAfterSeconds: IDEMPOTENCY_STALE_AFTER_SECONDS,
      imports: [DatabaseModule],
    }),
  ],
});

/** The read endpoints (`/idempotency-keys/*`, gated by `idempotency.view`; saved bodies by `idempotency.view-response`). */
export const idempotencyApi = IdempotencyApiModule.forRoot({
  imports: [PostgresIdempotencyObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] })],
});

const KEEP_HOURS = 24;
const HOUR = 60 * 60 * 1000;

/**
 * The cleanup is the consumer's (the module's README: a plain DELETE, safe to run concurrently). The sandbox has no
 * scheduler yet, so this stands in for one: at boot, then hourly. A product runs the same statement from its own
 * scheduler — a background-jobs `ScheduledJob` once that module is here.
 */
@Injectable()
class IdempotencyCleanupTask implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('IdempotencyCleanup');
  private timer?: NodeJS.Timeout;

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  onApplicationBootstrap() {
    void this.cleanup();
    this.timer = setInterval(() => void this.cleanup(), HOUR);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private async cleanup() {
    try {
      const { rows } = await this.db.execute(sql`
        delete from commons_idempotency_key
        where created_at < now() - make_interval(hours => ${KEEP_HOURS})
        returning key
      `);
      if (rows.length > 0) this.logger.log(`Deleted ${rows.length} idempotency claim(s) older than ${KEEP_HOURS} hours`);
    } catch (err) {
      this.logger.error('Idempotency cleanup failed', err instanceof Error ? err.stack : String(err));
    }
  }
}

@Module({
  imports: [DatabaseModule],
  providers: [IdempotencyCleanupTask],
})
export class IdempotencyCleanupModule {}
