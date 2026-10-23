# `authorization.core.permission-table` — Model 2 family

The database-backed authorization model, **stack-agnostic**. This package ships
everything that doesn't depend on a particular database: the ports a stack
adapter implements, the answer-shapes an admin UI consumes, the resolution
algorithm, the delegation rules + service, and the per-request cache.

It ships **no SQL and no schema** — that's a stack adapter's job:

- **`authorization.core.permission-table.postgres-drizzle`** — Postgres + Drizzle.
- a community `…mysql-drizzle`, `…postgres-prisma`, etc. slots in beside it,
  implementing the same ports.

## The model

`persona` (on `Actor`) stays a **coarse label** — the DB model never reads it.
All permission comes from **roles** a user holds (per tenant, or globally), plus
**minimal delegation** — one user lending a subset of their own role-derived
actions to another, within a tenant, time-boxed and revocable.

`can()` resolves as: *does any assigned role grant every action, or this action;
or is this action actively delegated to the actor in this tenant?*

## Ports a stack adapter implements

| Port | Bound under | For |
|---|---|---|
| `PermissionRepository` | `PERMISSION_REPOSITORY` | the two role/delegation reads `PermissionResolver` needs |
| `DelegationRepository` | `DELEGATION_REPOSITORY` | delegation-row insert / revoke / list |
| `AuthzAdminPort` | `AUTHZ_ADMIN_PORT` | `assignRole` / `revokeRole` / `setActionDescription` |
| `AuthzObservabilityPort` | `AUTHZ_OBSERVABILITY_PORT` | `listRoles` / `listUserRoleAssignments` / `explainAccess` / `listDelegations` / `actionCatalogHealth` |

## What this package provides on top

- **`PermissionResolver`** — repo reads → effective permission set, behind the cache.
- **`PermissionTableAuthorizer`** — the `Authorizer` (with `allowedActions`), on `PermissionResolver`.
- **`DelegationService`** — `delegate` / `revokeDelegation` / `listDelegations`; enforces the expiry cap, "granter holds it from roles", and chain-blocking (`delegation.rules.ts`, pure).
- **`AuthorizationCacheMiddleware`** / `runWithPermissionCache` / `memoizePermissionLookup` — the per-request memo (`AsyncLocalStorage`, stack-agnostic).
- **`permissionTableProviders({ maxDelegationDays? })`** — the DI provider list a stack adapter spreads after binding its two repositories.

## How a stack adapter wires it

```typescript
@Module({})
export class PostgresPermissionTableModule {
  static forRoot(config): DynamicModule {
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
```

Then the vertical:

```typescript
AuthorizationModule.forRoot({
  authorizerToken: PERMISSION_TABLE_AUTHORIZER,
  imports: [PostgresPermissionTableModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] })],
})
```

## Admin / observability

The two admin ports are independent of the authorizer wiring — a stack adapter
binds them in a separate module (`PostgresAuthzAdminModule`) so a role-management
screen can import just that. `authorization.api` serves them over HTTP, depending
on **these ports only**, never on a stack adapter.

`RoleNotFoundError` / `ActionNotFoundError` are defined here (not in an adapter)
so any caller can `catch` them.

## Deferred (documented, not built)

Role hierarchy (`parent_id` + recursive resolution); delegation advanced (live
re-check, cascade-revoke, chains, resource scoping, approvals); resource-level
grants (`can(actor, action, resource?)`); role→permission editing at runtime;
node-level TTL permission memo. See a stack adapter's README for the SQL-shaped
detail.

## Depends on

`authorization.core`, `@nestjs/common`. **No database driver, no ORM.**
