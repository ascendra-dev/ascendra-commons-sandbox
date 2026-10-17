# `authorization.core.static-map` — Model 1

The minimum viable authorizer: a constant `persona -> actions` object, resolved
by an in-memory lookup. No database, no admin UI, no migration. This is what
ships by default and what most small verticals stay on.

## The model

```typescript
StaticMapAuthorizerModule.forRoot({
  personaActions: {
    issuer: ['invoice.create', 'invoice.view', 'invoice.void'],
    payer: ['invoice.view'],
    ascendra_admin: '*',   // unrestricted by definition
  },
})
```

- `'*'` for a persona → every action, unconditionally.
- A persona with **no entry** → denied (fails closed), never treated as unrestricted.
- `personaActions` is required — `forRoot()` throws without it.

## Wiring

```typescript
AuthorizationModule.forRoot({
  authorizerToken: STATIC_MAP_AUTHORIZER,
  imports: [StaticMapAuthorizerModule.forRoot({ personaActions: PERSONA_ACTIONS })],
})
```

`StaticRoleMapAuthorizer` implements the optional `allowedActions`, so
`computeSessionSnapshot` (`/me`) resolves in one pass.

## When to move to Model 2

When a specific story needs a capability the persona model genuinely cannot
express — a per-tenant role a user holds independent of their persona, or one
user delegating a subset of their actions to another. That's
`authorization.core.permission-table`. Switching is: swap `STATIC_MAP_AUTHORIZER`
→ `PERMISSION_TABLE_AUTHORIZER`, swap the imported module, run the seed helper
once. No call site changes.

## Consuming this module

Copy `authorization/authorization.core.static-map/` alongside
`authorization/authorization.core/`.

## Depends on

`authorization.core`, `@nestjs/common`.
