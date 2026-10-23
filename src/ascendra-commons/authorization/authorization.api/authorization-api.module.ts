import { DynamicModule, Module } from '@nestjs/common';
import { AUTHZ_API_OPTIONS, AUTHZ_AUDIT_EMITTER } from './tokens';
import { resolveAuthzApiOptions, type AuthzApiModuleConfig } from './authz-api.options';
import { NoopAuthzAuditEmitter } from './authz-audit.port';
import { AuthzObservabilityApiService } from './observability/authz-observability-api.service';
import { AuthzObservabilityController } from './observability/authz-observability.controller';
import { AuthzAdminApiService } from './admin/authz-admin-api.service';
import { AuthzAdminController } from './admin/authz-admin.controller';
import { AuthzDelegationApiService } from './delegation/authz-delegation-api.service';
import { AuthzDelegationController } from './delegation/authz-delegation.controller';
import { AuthzAccessScope } from './shared/access-scope';
import { AuthzPeopleApiService } from './people/authz-people-api.service';
import { AuthzPeopleController } from './people/authz-people.controller';
import { AUTHZ_USER_DIRECTORY } from './tokens';
import { AuthzDenialsApiService } from './denials/authz-denials-api.service';
import { AuthzDenialsController } from './denials/authz-denials.controller';

/**
 * HTTP endpoints for a role-management / access-audit UI, over the
 * `authorization.core.permission-table` ports. Opt-in, stack-agnostic — it
 * depends on `AUTHZ_ADMIN_PORT` / `AUTHZ_OBSERVABILITY_PORT` /
 * `AUTHZ_DELEGATION_SERVICE` (brought in via `imports`), never on a stack
 * adapter directly.
 *
 * Requires `AuthorizationGuard` wired globally as `APP_GUARD` — the endpoints
 * declare `@RequiresAction('authz.*')` and rely on the global guard to enforce
 * it. Audit is opt-in: pass `auditEmitterToken` (bound to an adapter over
 * `audit-logging`) or leave it and mutations are not recorded.
 *
 * ```typescript
 * AuthorizationApiModule.forRoot({
 *   actionCatalog: Object.values(Actions),
 *   auditEmitterToken: MY_AUDIT_EMITTER,        // optional
 *   imports: [
 *     PostgresAuthzAdminModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
 *     // PostgresPermissionTableModule is already imported by AuthorizationModule.forRoot —
 *     // re-list it here only if AUTHZ_DELEGATION_SERVICE isn't otherwise visible.
 *   ],
 * })
 * ```
 */
@Module({})
export class AuthorizationApiModule {
  static forRoot(config: AuthzApiModuleConfig): DynamicModule {
    return {
      module: AuthorizationApiModule,
      imports: config.imports ?? [],
      // Admin first: its static `roles/assignable` must be matched before the observability controller's `roles/:id`.
      controllers: [AuthzAdminController, AuthzDelegationController, AuthzPeopleController, AuthzDenialsController, AuthzObservabilityController],
      providers: [
        { provide: AUTHZ_API_OPTIONS, useValue: resolveAuthzApiOptions(config) },
        config.auditEmitterToken
          ? { provide: AUTHZ_AUDIT_EMITTER, useExisting: config.auditEmitterToken }
          : { provide: AUTHZ_AUDIT_EMITTER, useClass: NoopAuthzAuditEmitter },
        ...(config.userDirectoryToken ? [{ provide: AUTHZ_USER_DIRECTORY, useExisting: config.userDirectoryToken }] : []),
        AuthzAccessScope,
        AuthzPeopleApiService,
        AuthzDenialsApiService,
        AuthzObservabilityApiService,
        AuthzAdminApiService,
        AuthzDelegationApiService,
      ],
    };
  }
}
