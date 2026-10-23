import { DynamicModule, Module } from '@nestjs/common';
import {
  permissionTableProviders,
  AUTHZ_DELEGATION_SERVICE,
  DELEGATION_REPOSITORY,
  PERMISSION_REPOSITORY,
  PERMISSION_TABLE_AUTHORIZER,
} from '../authorization.core.permission-table';
import { PostgresPermissionRepository } from './authorizer/postgres-permission.repository';
import { PostgresDelegationRepository } from './delegation/postgres-delegation.repository';
import { AUTHZ_SQL_EXECUTOR } from './tokens';

export interface PostgresPermissionTableModuleConfig {
  /**
   * The injection token the consuming app already provides its Drizzle db
   * client under. Aliased via `useExisting`, never constructed here.
   */
  sqlExecutorToken: string | symbol | (new (...args: never[]) => unknown);
  /**
   * Hard cap on delegation lifetime, in days. Default 90. Every `delegate()`
   * call must set `expiresAt` within this window.
   */
  maxDelegationDays?: number;
  /**
   * Whatever module(s) export the provider behind `sqlExecutorToken`.
   * `useExisting` only resolves a token NestJS can already see in *this*
   * module's own providers or imports.
   */
  imports?: DynamicModule['imports'];
}

/**
 * The Postgres/Drizzle Model 2 wiring. Binds the two repositories, spreads
 * `permissionTableProviders()` for the stack-agnostic resolver / authorizer /
 * delegation service, and exports:
 *
 *  - `PERMISSION_TABLE_AUTHORIZER` — pass to
 *    `AuthorizationModule.forRoot({ authorizerToken: PERMISSION_TABLE_AUTHORIZER })`
 *  - `AUTHZ_DELEGATION_SERVICE` — inject where you manage delegations
 *
 * ```typescript
 * AuthorizationModule.forRoot({
 *   authorizerToken: PERMISSION_TABLE_AUTHORIZER,
 *   imports: [
 *     PostgresPermissionTableModule.forRoot({
 *       sqlExecutorToken: DATABASE_CONNECTION,
 *       imports: [DatabaseModule],
 *     }),
 *   ],
 * })
 * ```
 */
@Module({})
export class PostgresPermissionTableModule {
  static forRoot(config: PostgresPermissionTableModuleConfig): DynamicModule {
    return {
      module: PostgresPermissionTableModule,
      imports: config.imports ?? [],
      providers: [
        { provide: AUTHZ_SQL_EXECUTOR, useExisting: config.sqlExecutorToken },
        PostgresPermissionRepository,
        { provide: PERMISSION_REPOSITORY, useExisting: PostgresPermissionRepository },
        PostgresDelegationRepository,
        { provide: DELEGATION_REPOSITORY, useExisting: PostgresDelegationRepository },
        ...permissionTableProviders({ maxDelegationDays: config.maxDelegationDays }),
      ],
      exports: [PERMISSION_TABLE_AUTHORIZER, AUTHZ_DELEGATION_SERVICE],
    };
  }
}
