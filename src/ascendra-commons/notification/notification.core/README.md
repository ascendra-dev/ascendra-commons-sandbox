# `notification.core` — the contract + the shipped mechanism

Inform users of events (invoice sent, payment received, reminders due) without
embedding notification logic in feature code. One `notificationType` fans out to
one or more channels (email, WhatsApp, SMS), configurably; a channel's identity
is fixed by business intent from day one, independent of whether its real
delivery mechanism exists yet.

This package is the model-agnostic core — the one thing feature code depends on
(`Notifier`), the ports, the stub senders and defaults. It ships **no config
source** (Model 1 = `notification.core.static`; Model 2 =
`notification.core.database` + a stack adapter) and **no admin surface**
(`notification.api`).

## What's in here

| Piece | Purpose |
|---|---|
| `Notifier` | **The one thing feature code injects.** A class, not an interface — `notify()` resolves the configured channels, calls each channel's `NotificationSender.send()` in parallel, aggregates to `sent` / `partial` / `failed` with the full per-channel breakdown in `channels`, and records each attempt best-effort. |
| `NotificationConfig` (port) | `channelsFor` / `templateFor` / `providerConfigFor` — where routing, templates and delivery credentials come from. Model 1 and Model 2 both implement this. `NotificationConfigData` is the plain in-memory shape (also the Model 2 seed input). |
| `NotificationSender` (port) + `EmailNotificationSender` / `WhatsappNotificationSender` / `SMSNotificationSender` | One sender per channel. The three shipped ones are **stubs** — the channel identity is real, the wire call is a `TODO` until the vertical names a real sender in `forRoot({ senders })`. `NotificationChannelResult.rendered` / `providerMessageId` feed the delivery log. |
| `renderTemplate(template, variables)` | `{{var}}` interpolation. No logic, no partials — deliberately minimal. |
| `NotificationDeliveryRecorder` (port) + `NoopNotificationDeliveryRecorder` | Best-effort "did it send" log hook. The Noop is the default; `notification.core.database.postgres-drizzle` ships the real one. |
| `UserContactResolver` (port) + `NullUserContactResolver` | Turns a recipient ref into an email / phone. The Null resolver returns nothing — bind a real one or pass contact details on the `NotificationRequest`. |
| `NotificationModule.forRoot({ configToken, deliveryRecorderToken?, imports })` | Pure token wiring: aliases `NOTIFICATION_CONFIG` to `configToken`, binds the senders + channel map + delivery recorder, provides `Notifier`. Throws without `configToken`. |

## `applicationId` / `tenantId`

No `applicationId` — a notification belongs to whichever app sent it, never a
shared destination. `tenantId` is on `NotificationRequest` and threaded to
`NotificationConfig`: `channelsFor` / `templateFor` treat it as an **override**
(a tenant-specific route/template wins over the deployment default), while
`providerConfigFor` has **no fall-through** — a missing per-tenant credential is
a `no_provider_config` failure, never "use another tenant's account".

## Wiring

```typescript
// Model 1 — the default
NotificationModule.forRoot({
  configToken: STATIC_NOTIFICATION_CONFIG,
  imports: [StaticNotificationConfigModule.forRoot({ channels: { 'invoice.sent': ['email'] }, templates: { ... } })],
})

// Model 2 — per-tenant routing / white-labeled templates / DB-editable config, on Postgres
NotificationModule.forRoot({
  configToken: POSTGRES_NOTIFICATION_CONFIG,
  deliveryRecorderToken: POSTGRES_NOTIFICATION_DELIVERY_RECORDER,   // optional
  imports: [PostgresNotificationConfigModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
})
```

Then feature code:

```typescript
await this.notifier.notify({ notificationType: 'invoice.sent', tenantId, recipient, variables: { invoiceNumber } });
```

## Consuming this module

`node ascendra-commons.js add` exactly one config source —
`notification.core.static`, or `notification.core.database.postgres-drizzle`
(which brings `notification.core.database`) — and optionally `notification.api`;
`notification.core` comes with any of them. Bind a real `NotificationSender` per channel you actually
deliver on.

## Depends on

`@nestjs/common`, `@nestjs/event-emitter`. No database driver, no ORM.
