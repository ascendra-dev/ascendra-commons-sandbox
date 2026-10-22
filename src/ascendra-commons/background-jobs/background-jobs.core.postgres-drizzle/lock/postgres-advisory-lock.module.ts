import { DynamicModule, Module } from '@nestjs/common';
import { PostgresAdvisoryLock } from './postgres-advisory-lock';
import { ADVISORY_LOCK_SQL_EXECUTOR, POSTGRES_ADVISORY_LOCK } from '../tokens';

export interface PostgresAdvisoryLockModuleConfig {
  /**
   * The token the consuming app provides its Drizzle db under. **Must be a
   * dedicated single connection** (`drizzle(new Pool({ max: 1, idleTimeoutMillis: 0 }))`),
   * never the app's request-serving pool and never a transaction-mode pooler —
   * a session-level advisory lock belongs to one physical connection, and
   * `tryAcquire()` / `release()` must run on the same one. Use
   * `PostgresLeaseLockModule` instead if that wiring is inconvenient.
   */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Provides `PostgresAdvisoryLock` and exports it as `POSTGRES_ADVISORY_LOCK`.
 * Pass that token as `BackgroundJobsModule.forRoot({ advisoryLockToken })`, with
 * this module in that same call's `imports`.
 */
@Module({})
export class PostgresAdvisoryLockModule {
  static forRoot(config: PostgresAdvisoryLockModuleConfig): DynamicModule {
    return {
      module: PostgresAdvisoryLockModule,
      imports: config.imports ?? [],
      providers: [
        { provide: ADVISORY_LOCK_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        PostgresAdvisoryLock,
        { provide: POSTGRES_ADVISORY_LOCK, useExisting: PostgresAdvisoryLock },
      ],
      exports: [POSTGRES_ADVISORY_LOCK],
    };
  }
}
