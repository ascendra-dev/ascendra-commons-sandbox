# `authorization.core.permission-table.postgres-drizzle` — Model 2 / Postgres

The Postgres + Drizzle stack adapter for the permission-table model. It ships
**only** schema, migrations, repositories, and seed helpers — the resolver, the
`Authorizer`, the delegation rules/service, the cache, and the admin ports are
stack-agnostic and live in `authorization.core.permission-table`.

A project on another stack ignores this folder and writes its own adapter
implementing the same ports (`PermissionRepository`, `DelegationRepository`,
`AuthzAdminPort`, `AuthzObservabilityPort`).

## Layout

| Folder | Contents |
|---|---|
| `persistence/` | `schema.ts` (Drizzle `pgTable` for `commons_authz_*`), `sql-executor.ts`, `sql-helpers.ts` |
| `migrations/` | the DDL, numbered — **never edited once released**; a schema change is the next file |
| `authorizer/` | `PostgresPermissionRepository` — implements `PermissionRepository` |
| `delegation/` | `PostgresDelegationRepository` — implements `DelegationRepository` |
| `admin/` | `PostgresAuthzAdminService` / `PostgresAuthzObservabilityService` — implement the admin ports |
| `seed/` | `syncActions()`, `seedRolesFromPersonaMap()` |

## Wiring

### 1. Create the tables

Apply `migrations/` (delivered into your migrations by `ascendra-commons.js`) with
your own migration tool — never re-export
the schema tables to `drizzle-kit` too, or it generates them a second time
(MODULE-STANDARD dimension 7). **Requires PostgreSQL 15+** (`NULLS NOT DISTINCT`).

### 2. Seed roles + actions (once, at deploy time / in a migration)

```typescript
import { seedRolesFromPersonaMap, syncActions } from '.../authorization.core.permission-table.postgres-drizzle';

await syncActions(db, Object.values(Actions));
await seedRolesFromPersonaMap(db, personaActions);
// then assign each user to their persona-role — you own the users table:
//   INSERT INTO commons_authz_user_role (user_id, tenant_id, role_id)
//   SELECT id, tenant_id, persona FROM app_user;
```

### 3. Flip the model

```typescript
import {
  PostgresPermissionTableModule,
  PostgresAuthzAdminModule,
} from '.../authorization.core.permission-table.postgres-drizzle';
import {
  PERMISSION_TABLE_AUTHORIZER,
  AuthorizationCacheMiddleware,
} from '.../authorization.core.permission-table';
import { AuthorizationModule } from '.../authorization.core';

@Module({
  imports: [
    AuthorizationModule.forRoot({
      authorizerToken: PERMISSION_TABLE_AUTHORIZER,
      imports: [
        PostgresPermissionTableModule.forRoot({
          sqlExecutorToken: DATABASE_CONNECTION,
          maxDelegationDays: 90,     // optional, default 90
          imports: [DatabaseModule],
        }),
      ],
    }),
    PostgresAuthzAdminModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
  ],
})
export class AppModule implements NestModule {
  configure(c: MiddlewareConsumer) {
    c.apply(AuthorizationCacheMiddleware).forRoutes('*');   // recommended — see the family README, "Caching"
  }
}
```

Every `can()` call site, the guard, `computeSessionSnapshot`,
`computeActionAvailability` — unchanged. To switch back to Model 1, restore the
`static-map` wiring.

## The security split to keep

- **Role definition** (which actions a role grants — `commons_authz_role_permission`)
  is **not** in `PostgresAuthzAdminService`: platform-admin territory, changed by
  migration/seed. Consider `REVOKE insert, update, delete ON commons_authz_role,
  commons_authz_role_permission, commons_authz_action` from the ordinary app DB role.
- **Role assignment** (`assignRole` / `revokeRole`) is ordinary tenant-scoped
  self-service — `authorization.api` gates it on `'authz.assign_roles'` and scopes
  it to the request actor's tenant.

## Deferred (documented, not built)

Role hierarchy (`commons_authz_role.parent_id` + recursive query + cycle
detection); delegation advanced (live re-check, cascade-revoke, chains, resource
scoping, approvals); resource-level grants (`authz_resource_grant` + RLS);
role→permission editing at runtime; node-level TTL permission memo.

## Depends on

`authorization.core.permission-table` (+ `authorization.core` transitively),
`@nestjs/common`, `drizzle-orm` (`drizzle-orm/pg-core`).
