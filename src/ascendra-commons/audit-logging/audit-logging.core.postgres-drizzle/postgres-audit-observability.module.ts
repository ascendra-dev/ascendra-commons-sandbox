import { DynamicModule, Module } from '@nestjs/common';
import { AUDIT_EVENT_READER } from '../audit-logging.core';
import { PostgresAuditEventReader } from './observability/postgres-audit-event-reader';
import { AUDIT_APPLICATION_ID, AUDIT_SQL_EXECUTOR } from './tokens';

export interface PostgresAuditObservabilityModuleConfig {
  /** The token the consuming app provides its Drizzle db under — the normal pooled connection is fine (reads only). */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /** Which Ascendra application this process is — every query is scoped to it. */
  application: string;
  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * Read-only reporting over `commons_audit_event` — binds `PostgresAuditEventReader`
 * under the core `AUDIT_EVENT_READER` token, so `audit-logging.api` (or your own
 * controller) depends on the port, not on Postgres.
 *
 * Independent of `PostgresAuditPersistenceModule` — import either or both; both
 * take the same `sqlExecutorToken` / `application`.
 */
@Module({})
export class PostgresAuditObservabilityModule {
  static forRoot(config: PostgresAuditObservabilityModuleConfig): DynamicModule {
    return {
      module: PostgresAuditObservabilityModule,
      imports: config.imports ?? [],
      providers: [
        { provide: AUDIT_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        { provide: AUDIT_APPLICATION_ID, useValue: config.application },
        PostgresAuditEventReader,
        { provide: AUDIT_EVENT_READER, useExisting: PostgresAuditEventReader },
      ],
      exports: [AUDIT_EVENT_READER],
    };
  }
}
