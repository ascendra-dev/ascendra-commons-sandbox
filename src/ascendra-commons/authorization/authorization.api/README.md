# `authorization.api` — HTTP endpoints for admin + observability

Opt-in NestJS controllers for a role-management / access-audit UI, over the
`authorization.core.permission-table` **ports**. Stack-agnostic — it never
imports a stack adapter; it's wired to one at the vertical via injection tokens.

This is the first `.api` package in `ascendra-commons` and deliberately overturns
the old "no shipped controllers" rule: these controllers carry no app-specific
logic (they operate purely on the ports + DTOs) and are gated by the consumer's
own `Authorizer`.

## Endpoints

| Method | Path | Gate (`@RequiresAction`) | → |
|---|---|---|---|
| GET | `/authz/roles` | `authz.view` | `listRoles` |
| GET | `/authz/assignments` | `authz.view` | `listUserRoleAssignments` |
| GET | `/authz/delegations` | `authz.view` | `listDelegations` (paginated) |
| GET | `/authz/explain` | `authz.view` | `explainAccess` |
| GET | `/authz/action-catalog/health` | `authz.view` | `actionCatalogHealth` |
| POST | `/authz/assignments` | `authz.assign_roles` | `assignRole` (actor-scoped) |
| DELETE | `/authz/assignments` | `authz.assign_roles` | `revokeRole` (actor-scoped) |
| PATCH | `/authz/actions/:name` | `authz.manage_catalog` | `setActionDescription` |
| POST | `/authz/delegations` | `authz.manage_delegations` | `delegate` (granter = actor) |
| DELETE | `/authz/delegations/:id` | `authz.manage_delegations` | `revokeDelegation` |
| GET | `/authz/delegations/mine` | `authz.manage_delegations` | `listDelegations(actor)` |

Gate names are fixed (`@RequiresAction` is applied at class-definition time). A
vertical whose catalog uses different names grants its admin role these too, or
writes its own thin controllers against the same ports.

## The `.api` service layer

Controllers are thin. The `*ApiService` classes hold what `@RequiresAction`
can't express:

- **Tenant ceiling** — a non-platform admin can only assign/revoke within their
  own tenant; `grantedBy` is always the request actor, never client-supplied.
- **Role ceiling** — only a platform admin may assign a `grantsAll` role.
- **Delegation** — granter/tenant/createdBy are always the request actor.
- **Audit emission** — each mutation emits an `AuthzAuditEvent` through the
  optional `AUTHZ_AUDIT_EMITTER` (no-op if unbound; **no** dependency on
  `audit-logging`).

"Platform admin" defaults to `actor.tenantId === null`; override via
`forRoot({ isPlatformAdmin })`.

## Wiring

```typescript
import { AuthorizationApiModule } from '.../authorization.api';
import {
  PostgresAuthzAdminModule,
  PostgresPermissionTableModule,
} from '.../authorization.core.permission-table.postgres-drizzle';

@Module({
  imports: [
    AuthorizationModule.forRoot({
      authorizerToken: PERMISSION_TABLE_AUTHORIZER,
      imports: [PostgresPermissionTableModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] })],
    }),
    AuthorizationApiModule.forRoot({
      actionCatalog: Object.values(Actions),
      auditEmitterToken: MY_AUDIT_EMITTER,       // optional
      imports: [
        PostgresAuthzAdminModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
        PostgresPermissionTableModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
      ],
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required — see below
  ],
})
export class AppModule {}
```

**Requires `AuthorizationGuard` as a global `APP_GUARD`.** The endpoints declare
`@RequiresAction` and rely on the global guard to enforce it — the intended
setup for `authorization.core` anyway. Without it, the endpoints are ungated.

## Depends on

`authorization.core`, `authorization.core.permission-table` (ports + DTO types +
`DelegationService`), `@nestjs/common`. **Never** a stack adapter. React/Next.js
is out of scope — a frontend counterpart belongs in `ascendra-commons-ui`.
