# `notification.api` — HTTP endpoints for admin + observability

Opt-in NestJS controllers for a "did it send / edit the config" admin UI, over
the `notification.core.database` **ports** + `Notifier`. Stack-agnostic — it
never imports a stack adapter; it's wired to one at the vertical via injection
tokens.

## Endpoints

| Method | Path | Gate | → |
|---|---|---|---|
| GET | `/notifications/deliveries` | `notification.view` | `getDeliveryHistory` — filtered, keyset-paginated, `{ data, meta: { nextCursor } }` |
| GET | `/notifications/deliveries/:id` | `notification.view` | one delivery's metadata (404 for another tenant's) |
| GET | `/notifications/deliveries/:id/content` | `notification.view_content` | the stored rendered message (404 if not stored) — **every read audited** |
| POST | `/notifications/deliveries/:id/retry` | `notification.retry` | resend a failed / bounced delivery on its channel — a user recipient with stored variables only; linked (`retryOf`), audited |
| GET | `/notifications/stats` | `notification.view` | counts by channel, type, day and failure reason over `?window=` — `24h` rolling, `7d` / `30d` whole calendar days in `?tz=`; test sends left out |
| GET | `/notifications/volume` | `notification.view` + platform admin | per-day rows over 30 days in `?tz=`, the table's size and age, rows still holding content |
| GET | `/notifications/config/coverage-gaps` | `notification.view` | holes in routing/templates/credentials — a default route is checked for every tenant (`tenantDirectoryToken`, else the tenants the config names) |
| GET | `/notifications/suppressions` | `notification.view` | recipients a channel stopped sending to (hard bounce, complaint) — an entry applies app-wide; a tenant admin sees every one its sends are affected by, each with `removable`; `{ data, meta }` |
| DELETE | `/notifications/suppressions/:id` | `notification.manage_config` | send to them again — audited; one another tenant's bounce filed is a 403 for a tenant admin (the platform's to remove) |
| GET | `/notifications/preferences/me` | signed in | my types, the channels each reaches me on, on or off — `required` ones always on |
| PUT | `/notifications/preferences/me` | signed in | `{ notificationType, channel, enabled }` (either may be `*`) — my own rule only |
| GET | `/notifications/inbox` | signed in | my in-app inbox, newest first — `?unread=true`, `{ data, meta }` |
| GET | `/notifications/inbox/unread-count` | signed in | `{ unread }` — the badge |
| POST | `/notifications/inbox/:id/read` | signed in | mark one of mine read (404 if not mine) |
| POST | `/notifications/inbox/read-all` | signed in | `{ marked }` |
| GET | `/notifications/types` | `notification.view` | the declared types (`NotificationModule.forRoot({ types })`) joined with their default channels, templates and gap counts — plus configured types nobody declared |
| GET | `/notifications/types/:name` | `notification.view` | one type: definition, every route and template the actor may see, its gaps |
| GET | `/notifications/config/routes` \| `/templates` \| `/credentials` | `notification.view` | `list*` — a tenant admin sees the defaults + their own tenant; credentials redacted (channel + tenant only) |
| PUT | `/notifications/config/routes` \| `/templates` \| `/credentials` | `notification.manage_config` | upsert one row (actor-scoped, validated, audited) |
| DELETE | `/notifications/config/routes/:notificationType` | `notification.manage_config` | `?tenantId=` — omitted = the default row; 404 if absent |
| DELETE | `/notifications/config/templates/:channel/:notificationType` | `notification.manage_config` | `?tenantId=` as above |
| DELETE | `/notifications/config/credentials/:channel` | `notification.manage_config` | `?tenantId=` required |
| POST | `/notifications/config/credentials/:channel/verify` | `notification.manage_config` | `?tenantId=` — asks the provider whether the credential works (`{ supported, ok, detail }`; the stubs can't) |
| POST | `/notifications/config/templates/preview` | `notification.view` | render a candidate template against sample variables — stateless |
| POST | `/notifications/test-send` | `notification.test_send` | `Notifier.notify()` — a real send to verify config |

**Declared types.** Once the app declares its types, a route or template for an undeclared type is a 400, a template
using a variable the type doesn't have is a 400, and a preview or test send fills the type's sample values.

**Recipient names.** Deliveries and suppressions carry `recipientName` for a user recipient when the app's
`UserContactResolver` returns a `name` (one `findByIds` call per page when it has one); a guest has none — its address
is never stored.

A caller's mistake is a 400 naming what to fix — never a 500 (bad dates, numbers, enums, cursors, bodies).

Gate names are fixed. A vertical whose catalog uses different names grants its
admin role these too.

## The `.api` service layer

Controllers are thin. The `*ApiService` classes hold:

- **Tenant ceiling** — a non-platform admin may only touch rows for **their own
  tenant**; a `null` tenantId (deployment default) is platform-admin only.
  test-send is likewise pinned to the actor's tenant.
- **Audit emission** — each config mutation emits a `NotificationAuditEvent`
  through the optional `NOTIFICATION_AUDIT_EMITTER` (no-op if unbound; **no**
  dependency on `audit-logging`). The credential *value* is never in the event.

"Platform admin" defaults to `actor.tenantId === null`; override via
`forRoot({ isPlatformAdmin })`.

## Wiring

```typescript
import { NotificationApiModule } from '.../notification.api';
import {
  PostgresNotificationAdminModule,
  PostgresNotificationConfigModule,
} from '.../notification.core.database.postgres-drizzle';

@Module({
  imports: [
    NotificationModule.forRoot({
      configToken: POSTGRES_NOTIFICATION_CONFIG,
      imports: [PostgresNotificationConfigModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
    }),
    NotificationApiModule.forRoot({
      auditEmitterToken: MY_AUDIT_EMITTER,       // optional
      imports: [
        PostgresNotificationAdminModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
        PostgresNotificationConfigModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }), // re-list so NOTIFIER's config is visible if needed
      ],
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required
  ],
})
export class AppModule {}
```

**Requires `AuthorizationGuard` as a global `APP_GUARD`** — the endpoints declare
`@RequiresAction` and rely on the global guard.

## Depends on

`notification.core`, `notification.core.database` (ports + DTOs), and
`authorization.core` (guard, `@RequiresAction`, `CurrentActor`, `Actor`).
**Never** a stack adapter. React/Next.js is out of scope — `ascendra-commons-ui`.
