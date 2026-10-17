# `audit-logging.core` — the contract + the shipped mechanism

An immutable "who did what, to what, when" record — distinct from ops logs
(debugging) and notifications (informing users). An **activity feed** is a
*view derived from* the audit log, never a second system.

Unlike `authorization` / `notification`, there is **no Model 1 / Model 2 config
split** — one model: feature code raises `AuditRecordRaised`, the shipped
`AuditListener` persists it through an `AuditEventRepository` port. "Broader
coverage" means only more call sites raising the event — same mechanism, no new
package.

## What's in here

| Piece | Purpose |
|---|---|
| `AuditRecordRaised` (+ `AUDIT_EVENT_NAME`) | The one event this pattern's listener reacts to. Raised **explicitly** by feature code, always under the one fixed name. Extends `DomainEvent`. |
| `AuditListener` | **Shipped, not consumer-authored** — `@OnCriticalEvent(AUDIT_EVENT_NAME)` → `persistAuditRecord`. A thin dispatcher by construction. Registered by `AuditLoggingModule.forRoot()`. |
| `persistAuditRecord()` | The one piece of real logic — no mapping step (`AuditEventInput` is a `Pick<>` of `AuditRecordRaised`), adds `correlationId` from ambient context. |
| `AuditEventRepository` (`insert()` only) | The **write** port — write-once by construction of the interface. Never assumes a database (an external sink is in scope). |
| `AuditEventReader` (`find(AuditQuery)`, `countUpTo(AuditQuery, max)`, …) | The **read** port — deliberately separate, so a custom write repo isn't forced to implement reads. `audit-logging.api` and a stack adapter's observability module use it. |
| `runWithCorrelationId` / `getCurrentCorrelationId` / `CorrelationIdMiddleware` | `AsyncLocalStorage` correlation id — works for an HTTP request and a background job run alike. `getCurrentCorrelationId()` never returns undefined. |
| `encodeKeysetCursor` / `decodeKeysetCursor` | Stack-agnostic pagination cursor for `AuditEventReader` (kept in `.core` so a second stack adapter reuses it). |
| `AuditLoggingModule.forRoot({ auditEventRepositoryToken, imports })` | Binds `AUDIT_EVENT_REPOSITORY` + registers `AuditListener`. |

## `applicationId` / `tenantId`

`audit-logging` is **the module to watch** for `applicationId` — cross-product
compliance reporting ("every admin action across every Ascendra product") is a
plausible near-term ask. The core takes no `application` — it's stamped on
insert by the stack adapter (a passive column today, never read). `tenantId` is
on `AuditRecordRaised` (nullable — a platform-level change has no single tenant).

**`action` is verb-only** (`'status_changed'`), not `resource.verb` —
`entityType` already carries the resource. This is deliberate, not a deviation
from `MODULE-STANDARD.md` dimension 9.

## Wiring

```typescript
DomainEventsModule.forRoot({     // required — the listener is reached via emitCritical()
  emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
  imports: [InProcessDomainEventEmitterModule.forRoot()],
}),
AuditLoggingModule.forRoot({
  auditEventRepositoryToken: POSTGRES_AUDIT_EVENT_REPOSITORY,
  imports: [PostgresAuditPersistenceModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
})
```

On another stack: provide your own `AuditEventRepository` (and, for reads, an
`AuditEventReader`) and pass the tokens instead.

## Consuming this module

Copy `audit-logging/audit-logging.core/` **and** `domain-events/domain-events.core`
+ `domain-events/domain-events.core.in-process` (this package depends on
`domain-events.core`; the vertical also needs a transport). Plus one stack
adapter, and optionally `audit-logging.api`.

## Depends on

`domain-events.core`, `@nestjs/common`. No database driver, no ORM.
