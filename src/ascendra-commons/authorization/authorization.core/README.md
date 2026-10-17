# `authorization.core` — the contract

Model-agnostic. Ships **no working authorizer** — just the contract every model
implements and the cross-cutting enforcement mechanism. Pick a model by also
vendoring one of:

- **`authorization.core.static-map`** (Model 1) — a constant `persona -> actions`
  map, resolved in memory. Zero infrastructure.
- **`authorization.core.permission-table`** + a stack adapter
  (`.postgres-drizzle`, …) (Model 2) — database-backed roles + delegation.

…or provide your own `Authorizer` on another stack.

## What's in here

| Piece | Purpose |
|---|---|
| `Authorizer` (`authorizer.port.ts`) | `can(actor, action)` + optional one-pass `allowedActions(actor, candidates)`. Async from the start so the Model 1 → Model 2 swap never touches a call site. |
| `Actor` (`actor.type.ts`) | `{ id, persona, tenantId }`. `persona` is a plain string — each project defines its own set. `tenantId` is nullable. |
| `@RequiresAction` / `@NoActionRequired` | Declare one action per state-changing endpoint, or opt out explicitly. |
| `AuthorizationGuard` | Deny-by-default: an endpoint under the guard with neither decorator throws `AuthorizationNotDeclaredError` (500, fails closed). Expects `request.actor` populated by an upstream auth guard. |
| `computeSessionSnapshot` | The computation behind a project's own `GET /me` — filters the full action list to what the actor holds. Uses `allowedActions` when the bound model implements it. |
| `computeActionAvailability` | Per-entity, per-action button state. Permission first, then business state — never leaks record state to an actor who can't act on it. |
| `AuthorizationModule.forRoot({ authorizerToken?, imports? })` | Pure token wiring: binds `AUTHORIZER` to `authorizerToken` (or to the throwing `MissingAuthorizer` when omitted) and provides `AuthorizationGuard`. |

## Wiring

```typescript
// Model 1
AuthorizationModule.forRoot({
  authorizerToken: STATIC_MAP_AUTHORIZER,
  imports: [StaticMapAuthorizerModule.forRoot({ personaActions: { issuer: ['invoice.void'], payer: [] } })],
})

// Model 2 (Postgres)
AuthorizationModule.forRoot({
  authorizerToken: PERMISSION_TABLE_AUTHORIZER,
  imports: [PostgresPermissionTableModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] })],
})
```

Both wire identically — a token plus the module that provides it. Call sites
(`@Inject(AUTHORIZER)`, `@RequiresAction`, the two `compute*` helpers) never
change between models.

`forRoot()` does **not** apply `AuthorizationGuard` globally — it's exported so
the consumer decides: globally via `{ provide: APP_GUARD, useExisting: AuthorizationGuard }`
(the intended setup — that's what makes deny-by-default meaningful), or
per-controller via `@UseGuards(AuthorizationGuard)`. Either way `request.actor`
must be populated by an authentication guard ordered before it — this module has
no opinion on how.

## Consuming this module

Copy `authorization/authorization.core/` into
`src/ascendra-commons/authorization/authorization.core/`, plus one model package.
A vendored module that depends on authorization (e.g. `file-storage`) depends on
**this package only**, never on a model or `.api` package.

## Depends on

`@nestjs/common`, `@nestjs/core`, `reflect-metadata`. No database driver, no ORM.
