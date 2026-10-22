import { DynamicModule, Module } from '@nestjs/common';
import { PostgresLeaseLock } from './postgres-lease-lock';
import {
  LEASE_LOCK_APPLICATION_ID,
  LEASE_LOCK_SECONDS,
  LEASE_LOCK_SQL_EXECUTOR,
  POSTGRES_LEASE_LOCK,
} from '../tokens';

export interface PostgresLeaseLockModuleConfig {
  /**
   * The token the consuming app provides its Drizzle db under. **Any pooled
   * connection is fine** — the lease lock has no connection-affinity
   * requirement, unlike the core's session-level `PostgresAdvisoryLock`.
   */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);

  /** Which Ascendra application this process is — scopes each `commons_jobs_lock` row. */
  application: string;

  /**
   * Lease duration in seconds. A holder that crashes without releasing frees
   * the lock after this long; a live run renews the lease every
   * `leaseSeconds / 3` so it can safely run longer. Default 900 (15 min).
   * Minimum 3. Set it comfortably above a job's worst-case run time — too
   * short risks two instances overlapping; too long only slows recovery after
   * a hard crash.
   */
  leaseSeconds?: number;

  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Provides `PostgresLeaseLock` and exports it as `POSTGRES_LEASE_LOCK`. Pass
 * that token as `BackgroundJobsModule.forRoot({ advisoryLockToken })`, with this
 * module in that same call's `imports`:
 *
 * ```typescript
 * BackgroundJobsModule.forRoot({
 *   advisoryLockToken: POSTGRES_LEASE_LOCK,
 *   imports: [
 *     PostgresLeaseLockModule.forRoot({
 *       sqlExecutorToken: DATABASE_CONNECTION, // the normal pooled db
 *       application: 'ascendra-pay',
 *       imports: [DatabaseModule],
 *     }),
 *   ],
 *   // sqlExecutorToken is not needed here when advisoryLockToken is set
 * })
 * ```
 */
@Module({})
export class PostgresLeaseLockModule {
  static forRoot(config: PostgresLeaseLockModuleConfig): DynamicModule {
    const leaseSeconds = config.leaseSeconds ?? 900;
    if (!Number.isFinite(leaseSeconds) || leaseSeconds < 3) {
      throw new Error(
        `PostgresLeaseLockModule.forRoot: leaseSeconds must be a finite number >= 3 (got ${String(config.leaseSeconds)}).`,
      );
    }

    return {
      module: PostgresLeaseLockModule,
      imports: config.imports ?? [],
      providers: [
        { provide: LEASE_LOCK_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: LEASE_LOCK_APPLICATION_ID, useValue: config.application },
        { provide: LEASE_LOCK_SECONDS, useValue: leaseSeconds },
        PostgresLeaseLock,
        { provide: POSTGRES_LEASE_LOCK, useExisting: PostgresLeaseLock },
      ],
      exports: [POSTGRES_LEASE_LOCK],
    };
  }
}
