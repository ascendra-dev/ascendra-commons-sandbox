# `notification.core.database.postgres-drizzle` — Model 2 / Postgres

The Postgres + Drizzle stack adapter. It implements three things over
`commons_notification_*`:

| Sub-folder | Implements | Bound under | Wired via |
|---|---|---|---|
| `config/` | `NotificationConfig` (routing / templates / credentials, TTL-cached) | `POSTGRES_NOTIFICATION_CONFIG` | `NotificationModule.forRoot({ configToken })` |
| `delivery-log/` | `NotificationDeliveryRecorder` (batched INSERT + webhook UPDATE) | `POSTGRES_NOTIFICATION_DELIVERY_RECORDER` | `NotificationModule.forRoot({ deliveryRecorderToken })` |
| `admin/` | `NotificationObservabilityPort` + `NotificationConfigAdminPort` | `NOTIFICATION_OBSERVABILITY_PORT` / `NOTIFICATION_CONFIG_ADMIN_PORT` (family tokens) | `PostgresNotificationAdminModule.forRoot(...)` |
| `persistence/` | `config.schema.ts` + `delivery.schema.ts` (Drizzle) — the tables' current shape | | |
| `migrations/` | the DDL, numbered — **never edited once released**; a schema change is the next file | | |
| `seed/` | `seedNotificationConfigFromData(db, application, data)` — behaviour-preserving `static` → `database` | | |

The resolver algorithm, the `ConfigCache`, the cursor helper, and the admin
ports/DTOs are stack-agnostic and live in `notification.core.database`.

## Wiring

### 1. Tables

Apply `migrations/` (`0001_config`, `0002_delivery`, `0003_delivery_test_flag`, `0004_platform_credential`, `0005_delivery_read_indexes`, `0006_delivery_recipient_key`, `0007_suppression`, `0008_dedupe`, `0009_preferences`, `0010_inbox`, `0011_delivery_retry_of`) (delivered into your migrations by `ascendra-commons.js`)
with your own migration tool — never re-export the schema tables to `drizzle-kit` too, or it
generates them a second time (MODULE-STANDARD dimension 7).
**Requires PostgreSQL 15+** (`NULLS NOT DISTINCT`).

### 2. Seed the deployment defaults

```typescript
import { seedNotificationConfigFromData } from '.../notification.core.database.postgres-drizzle';

await seedNotificationConfigFromData(db, 'ascendra-pay', {   // same `application` as forRoot()
  channels: { 'invoice.sent': ['email'] },
  templates: { email: { 'invoice.sent': { subject: '...', body: '...' } } },
  providerConfigs: { email: { 'tenant-a': { apiKey: '...' } } },
});
```

### 3. Flip the model (+ optional delivery log + admin)

```typescript
NotificationModule.forRoot({
  configToken: POSTGRES_NOTIFICATION_CONFIG,
  deliveryRecorderToken: POSTGRES_NOTIFICATION_DELIVERY_RECORDER,   // optional
  imports: [
    PostgresNotificationConfigModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
    PostgresNotificationDeliveryRecorderModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', storeContent: false, imports: [DatabaseModule] }),
  ],
}),
PostgresNotificationAdminModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
```

`Notifier`, the senders, every call site — unchanged.

## `application` scoping

Every row carries `application` and every read/write filters `WHERE application = $1`
(from `forRoot({ application })`). Constant within one app's own database, so it
costs nothing there — but it keeps the tables correct if all Ascendra apps'
notification config is ever consolidated into one shared database.

## Credentials — one opaque `config` jsonb

Returned **verbatim** as `ProviderConfig`; the library never reads inside it.

A row per tenant is that tenant's own account; the row with `tenant_id` NULL is the **platform's**. A tenantless
send uses the platform's. A tenant with no row fails `no_provider_config` — unless the app passes
`tenantCredentialFallback: true` to `PostgresNotificationConfigModule` (and the same to
`PostgresNotificationAdminModule`, so coverage gaps agree), when it sends through the platform's. Never another
tenant's account. Only a platform admin may set or delete the platform's row.
It typically holds live secrets — **encrypt at rest** (Supabase Vault, `pgcrypto`
+ decrypting view, or `REVOKE select` from the ordinary read role).

## The delivery log's write path — buffered

`PostgresNotificationDeliveryRecorder` never makes a send wait on the database: `recordAttempts` queues the rows, and
they're written every `flushIntervalMs` (default 2 s) — or at once when 1,000 are waiting — in multi-row `INSERT`s.
Each row is normalized as it's queued. A failed write is logged with how many rows it lost (never retried, never
thrown). While the database is slow, at most `maxBufferedRows` (50,000) wait; past it the oldest are dropped and
counted. Call `app.enableShutdownHooks()` so the last rows are written on shutdown. A provider webhook's
`updateDeliveryStatus` writes the queue first, so it never misses a row still waiting.

## The in-app inbox

`PostgresNotificationInboxModule.forRoot({ sqlExecutorToken, application, imports })` — pass
`POSTGRES_NOTIFICATION_INBOX` as `NotificationModule.forRoot({ inboxToken })` (the `in_app` channel delivers there),
and import the module into `NotificationApiModule` too for the user's inbox endpoints. Schedule
`PostgresNotificationRetentionService.pruneInbox(before)`.

## Users' preferences

`PostgresNotificationPreferencesModule.forRoot({ sqlExecutorToken, application, imports })` — pass
`POSTGRES_NOTIFICATION_PREFERENCES` as `NotificationModule.forRoot({ preferencesToken })`, and import the module into
`NotificationApiModule` too for "my preferences". A rule is a type (or `*`) on a channel (or `*`); the most specific
wins; a `required` type always sends. A user's rules are cached 30 s, cleared when one changes in this process.

## Dedupe keys

`PostgresNotificationDedupeModule.forRoot({ sqlExecutorToken, application, imports })` provides the store behind
`notify({ dedupeKey })` — pass `POSTGRES_NOTIFICATION_DEDUPLICATOR` as `NotificationModule.forRoot({ deduplicatorToken,
dedupeWindowMs })`. A second call with the same key within the window (24 h by default) sends nothing and returns the
first call's result. Schedule `PostgresNotificationRetentionService.pruneDedupeKeys()` to delete expired keys.

## Suppression list

`PostgresNotificationSuppressionModule.forRoot({ sqlExecutorToken, application, imports })` provides the list
`Notifier` asks before each channel's send — pass `POSTGRES_NOTIFICATION_SUPPRESSION_LIST` as
`NotificationModule.forRoot({ suppressionListToken })`. Your provider-webhook controller files an entry by calling
`updateDeliveryStatus({ providerMessageId, status: 'bounced', suppress: true })` for a hard bounce or a complaint —
the delivery's recipient key goes on the list (a guest's only with `recipientHashKey`). Lookups are cached 30 s; an
entry removed through `DELETE /notifications/suppressions/:id` is seen at once in that process.

## `storeContent` (delivery log)

`PostgresNotificationDeliveryRecorderModule.forRoot({ storeContent: true })` →
the `content` jsonb column gets the rendered `{ subject, body, isHtml, variables }`.
**Default off** — full-fidelity PII, pruned with the row. Read one row's content
with `NotificationObservabilityPort.getDeliveryContent(id)`.

## Retention

`PostgresNotificationRetentionModule.forRoot({ sqlExecutorToken, application, imports })` provides
`PostgresNotificationRetentionService` — the consumer schedules it (a `background-jobs` `ScheduledJob`, a cron):

- `clearContent(before)` — empties the stored message (`content`, personal data) of older rows, keeping the rows.
  Suggested: 30 days.
- `pruneDeliveries(before)` — deletes older rows. Suggested: 90 days.

Both work in batches of 5,000, `application`-qualified.

## Depends on

`notification.core.database` (+ `notification.core` transitively), `@nestjs/common`,
`drizzle-orm` (`drizzle-orm/pg-core`).
