# `domain-events.core` — the contract, transport-agnostic

Business logic publishes an event; each concern (notification, audit logging,
…) subscribes independently. This package fixes the **producer** surface;
neither transport implementation lives here.

There *is* a real Model 1 / Model 2 split — in-process dispatch vs a message
broker — so each transport is its own package:

- **`domain-events.core.in-process`** (Model 1) — `EventEmitter2`, listeners in
  the same process, `emitCritical()` runs inside the caller's transaction.
- **`domain-events.core.broker`** (Model 2) — a deliberate stub that throws
  `BrokerTransportNotImplementedError`; the seam (selector, interface, token)
  is real so adopting a broker later is a wiring change, not a refactor.

## What's in here

| Piece | Purpose |
|---|---|
| `DomainEventEmitter` (`domain-event-emitter.port.ts`) | `emit(name, event): void` (fire-and-forget) / `emitCritical(name, event): Promise<void>` (awaited; a listener failure reaches the producer). The **entire** coupling surface for business logic — injected via `DOMAIN_EVENT_EMITTER`. |
| `DomainEvent` (`domain-event.interface.ts`) | Marker — `occurredAt: Date`. Each consuming project defines one plain class per fact. Every field must be JSON-serializable (so Model 2 can enqueue it unchanged). |
| `assertDomainEventSerializable()` | Design-time guard — call it from each event class's own `.spec.ts`. Throws listing anything `JSON.stringify` would drop/corrupt. |
| `OnCriticalEvent` | Listener decorator — `@OnEvent()` with `suppressErrors: false`, so an `emitCritical()` listener's failure actually propagates. |
| `DomainEventsModule.forRoot({ emitterToken, imports })` | Pure token wiring — aliases `DOMAIN_EVENT_EMITTER` to `emitterToken`. |
| `EventDeliveryRecorder` (`event-delivery-recorder.port.ts`) | What a transport calls to log one delivery attempt — **delivery only**, never a listener's own outcome. Optional; `NoopEventDeliveryRecorder` is the default. |
| `EventDeliveryObservabilityPort` (`event-delivery-observability.port.ts`) | Read-only reporting over the delivery log (`listDeliveries`, `deliveryCatalog`) for an admin screen. Implemented by a stack adapter. |
| `EventListenerCatalogPort` (`event-listener-catalog.port.ts`) | The static "what listens to what" wiring map. Only `domain-events.core.in-process` implements it — see that port's own doc comment. |

## The listener side has no transport seam

`@OnEvent()` / `@OnCriticalEvent()` are raw `@nestjs/event-emitter` decorators —
they work only because in-process everything runs on one `EventEmitter2`. Under
a broker every listener needs real review (at-least-once delivery, no
transactional rollback, ack semantics). `OnCriticalEvent` lives here as the
*critical-listener contract marker*, but the mechanism is in-process today.
**Write every decorated method as a thin dispatcher** calling a plain function
for the real logic — that shrinks the Model 2 rework (`audit-logging`'s
`AuditListener` is the reference).

## Wiring

```typescript
// Model 1 — the normal case
DomainEventsModule.forRoot({
  emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
  imports: [InProcessDomainEventEmitterModule.forRoot()],
})

// Model 2 — wires, throws on first emit
DomainEventsModule.forRoot({
  emitterToken: BROKER_DOMAIN_EVENT_EMITTER,
  imports: [BrokerDomainEventEmitterModule.forRoot({ application: 'ascendra-pay' })],
})
```

## `applicationId` / `tenantId` / `correlationId`

Neither `applicationId` nor `tenantId` is in `.core`. `tenantId` is a payload
fact each concrete event class carries itself (never derived from ambient
context — see the split note below). `application` is a **broker-only**
concern (topic naming across apps) and lives entirely in
`domain-events.core.broker`; nothing in-process reads it.

`correlationId` **is** in `.core` — an optional third argument on both
`emit()`/`emitCritical()` (the same shape `JobTrigger.trigger()` and
`NotificationRequest.correlationId` already take), threaded into the delivery
log for a cross-module trace. It's plumbing to the delivery log, not a fact of
what happened, so — unlike `tenantId` — it isn't a field on the event payload
itself.

## Delivery observability & the listener catalogue (2026-09-12)

Two independent, complementary reads, both consumed by `domain-events.api`:

- **The delivery log** (`EventDeliveryObservabilityPort`) — *did this event
  actually fire, and was anyone listening* — built from what
  `domain-events.core.in-process` observed at runtime. Written by
  `domain-events.core.postgres-drizzle`'s recorder.
- **The listener catalogue** (`EventListenerCatalogPort`) — *what does the code
  say should be listening* — a live, always-current read of
  `@OnEvent()`/`@OnCriticalEvent()` decorator metadata, no database involved.
  Cross-referencing the two catches both an event nobody listens to and a
  listener registered for an event name that's never emitted (a likely typo).

**What this does and doesn't observe:** both reads answer "did the transport
hand the event off," never "what happened after." Whether a listener's own
handling then succeeded (the audit record actually wrote, the notification
actually sent) is that listener's own module's concern — recorded, if at all,
in that module's own observability (`audit-logging`'s, `notification`'s). This
module only ever reports on delivery.

## Depends on

`@nestjs/common`, `@nestjs/event-emitter` (for `OnCriticalEvent`).
