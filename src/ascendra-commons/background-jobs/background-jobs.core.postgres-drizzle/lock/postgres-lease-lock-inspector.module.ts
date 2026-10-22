import { DynamicModule, Module } from '@nestjs/common';
import { JOB_LOCK_INSPECTOR_PORT } from '../../background-jobs.core';
import { PostgresLeaseLockInspector } from './postgres-lease-lock-inspector';
import { LEASE_LOCK_APPLICATION_ID, LEASE_LOCK_SQL_EXECUTOR } from '../tokens';

export interface PostgresLeaseLockInspectorModuleConfig {
  /** The token the consuming app provides its Drizzle db under — the normal pooled connection is fine (reads only). */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /** The same `application` as `PostgresLeaseLockModule.forRoot` — only this app's locks are listed. */
  application: string;
  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Binds `PostgresLeaseLockInspector` under the core `JOB_LOCK_INSPECTOR_PORT` — put it in
 * `JobsApiModule.forRoot({ imports })` and `GET /jobs/locks` lists the lease lock's rows. Only for an app on
 * `PostgresLeaseLock`; with `PostgresAdvisoryLock` leave it out and the endpoint answers `supported: false`.
 * Separate from `PostgresLeaseLockModule` so the admin API never instantiates a second lock.
 */
@Module({})
export class PostgresLeaseLockInspectorModule {
  static forRoot(config: PostgresLeaseLockInspectorModuleConfig): DynamicModule {
    return {
      module: PostgresLeaseLockInspectorModule,
      imports: config.imports ?? [],
      providers: [
        { provide: LEASE_LOCK_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: LEASE_LOCK_APPLICATION_ID, useValue: config.application },
        PostgresLeaseLockInspector,
        { provide: JOB_LOCK_INSPECTOR_PORT, useExisting: PostgresLeaseLockInspector },
      ],
      exports: [JOB_LOCK_INSPECTOR_PORT],
    };
  }
}
