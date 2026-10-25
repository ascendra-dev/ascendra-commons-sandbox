# `notification.core.database` — Model 2 family

The database-backed notification config + delivery-log + admin story,
**stack-agnostic**. This package ships no SQL and no schema — it holds the parts
that don't depend on a particular database:

| Piece | For |
|---|---|
| `ConfigCache` | the short per-process TTL memo every `NotificationConfig` adapter reads config through |
| `encodeKeysetCursor` / `decodeKeysetCursor` | opaque pagination cursor for the delivery-history read |
| `NotificationObservabilityPort` | `getDeliveryHistory` / `getDeliveryContent` / `configCoverageGaps` — bound under `NOTIFICATION_OBSERVABILITY_PORT` |
| `NotificationConfigAdminPort` | route / template / credential CRUD — bound under `NOTIFICATION_CONFIG_ADMIN_PORT` |
| DTOs + write-input types | the answer-shapes `notification.api` serves |

The `NotificationConfig` and `NotificationDeliveryRecorder` **interfaces** stay
in `notification.core` (Model 1 implements the first; the `Noop` recorder is the
default). This family adds only the *database-specific* contracts.

## Stack adapters

- **`notification.core.database.postgres-drizzle`** — Postgres + Drizzle.
- A community `…mysql-drizzle`, `…postgres-prisma`, etc. slots in beside it,
  implementing `NotificationConfig` + `NotificationDeliveryRecorder` + these two
  ports, reusing `ConfigCache` and the cursor helper.

## Resolution contract every adapter honors

- `channelsFor` / `templateFor` — a **tenant-specific row wins** over the
  `tenant_id IS NULL` deployment default.
- `providerConfigFor` — **no fall-through**; a missing row is `no_provider_config`,
  never another tenant's account. A `null` tenantId short-circuits to `null`.
- Every read/write is scoped by `application` (which Ascendra app the process is).

## Depends on

`notification.core`. **No database driver, no ORM.**
