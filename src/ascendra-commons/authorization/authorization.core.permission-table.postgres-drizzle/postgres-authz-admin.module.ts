import { DynamicModule, Module } from '@nestjs/common';
import { AUTHZ_ADMIN_PORT, AUTHZ_OBSERVABILITY_PORT } from '../authorization.core.permission-table';
import { PostgresAuthzAdminService } from './admin/postgres-authz-admin.service';
import { PostgresAuthzObservabilityService } from './admin/postgres-authz-observability.service';
import { AUTHZ_SQL_EXECUTOR } from './tokens';

export interface PostgresAuthzAdminModuleConfig {
  /** The token the consuming app provides its Drizzle db under — the normal pooled connection is fine. */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /** Whatever module(s) export the provider behind `sqlExecutorToken`. Omit only if that module is `global: true`. */
  imports?: DynamicModule['imports'];
}

/**
 * The Postgres/Drizzle implementations of the admin ports, for a role-management
 * screen. Bound under the family tokens so `authorization.api` (or your own
 * controllers) can depend on `AUTHZ_ADMIN_PORT` / `AUTHZ_OBSERVABILITY_PORT`
 * without knowing Postgres is underneath.
 *
 * Independent of `PostgresPermissionTableModule` — import either or both (both
 * take the same `sqlExecutorToken`). Delegation create/revoke stays in
 * `DelegationService` (from `PostgresPermissionTableModule`).
 */
@Module({})
export class PostgresAuthzAdminModule {
  static forRoot(config: PostgresAuthzAdminModuleConfig): DynamicModule {
    return {
      module: PostgresAuthzAdminModule,
      imports: config.imports ?? [],
      providers: [
        { provide: AUTHZ_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        PostgresAuthzObservabilityService,
        { provide: AUTHZ_OBSERVABILITY_PORT, useExisting: PostgresAuthzObservabilityService },
        PostgresAuthzAdminService,
        { provide: AUTHZ_ADMIN_PORT, useExisting: PostgresAuthzAdminService },
      ],
      exports: [AUTHZ_OBSERVABILITY_PORT, AUTHZ_ADMIN_PORT],
    };
  }
}
