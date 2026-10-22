# `domain-events.core.in-process` — Model 1

`EventEmitter2` (`@nestjs/event-emitter`), listeners in the same process. Not a
message broker. `emitCritical()` runs the listener synchronously inside the
producer's call stack, so if the producer opened a transaction around the emit
and rethrows what `emitCritical()` propagates, that transaction rolls back. The
emitter itself never touches a transaction — the rollback decision is the
producer's.

## Wiring

```typescript
DomainEventsModule.forRoot({
  emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
  imports: [InProcessDomainEventEmitterModule.forRoot()],
})
```

`InProcessDomainEventEmitterModule.forRoot()` owns
`EventEmitterModule.forRoot({ global: false })` — see its doc comment for why
`{ global: false }` (it closes the raw-`EventEmitter2` bypass of the
reliability tiering).

## Delivery observability (built, 2026-09-12)

`InProcessDomainEventEmitter` also records one `EventDeliveryAttempt` per
`emit()`/`emitCritical()` call, through the optional `EVENT_DELIVERY_RECORDER`
token (`EventDeliveryRecorder` interface, `domain-events.core`). **Delivery
only** — was a listener subscribed, did the hand-off happen — never a
listener's own outcome (whether the audit write or notification send actually
succeeded is that listener's own module's concern, not recorded here). Opt-in:

```typescript
InProcessDomainEventEmitterModule.forRoot({
  recorderToken: POSTGRES_EVENT_DELIVERY_RECORDER, // optional — omit for a no-op
  imports: [PostgresEventDeliveryRecorderModule.forRoot({ ... })],
})
```

Omit `recorderToken` and every call is a no-op (`NoopEventDeliveryRecorder`) —
the emitter behaves exactly as before. See `domain-events.core.postgres-drizzle`
for the reference Postgres implementation, and `domain-events.api` for the
read surface.

**The app's correlation id, without threading it.** A producer may pass a correlation id as `emit()`'s third
argument; when it doesn't, `correlationIdResolver` supplies the ambient one — the same request / job context the app's
other modules read (this package never imports them):

```typescript
import { getCurrentCorrelationId } from '…/audit-logging/audit-logging.core';

InProcessDomainEventEmitterModule.forRoot({
  recorderToken: POSTGRES_EVENT_DELIVERY_RECORDER,
  correlationIdResolver: getCurrentCorrelationId,
  imports: [/* … */],
})
```

An explicit argument always wins. A resolver that throws or returns nothing leaves the delivery without one, and the
emit is unaffected. (audit-logging's resolver mints a fresh id outside any request or job, so a standalone emit is a
trace of one.)

This module also provides `DomainEventListenerCatalog` (bound under
`EVENT_LISTENER_CATALOG_PORT`) — the static "what listens to what" wiring map,
discovered from `@OnEvent()`/`@OnCriticalEvent()` decorator metadata, always
bound (no config needed). See its own doc comment for why only Model 1 can
provide this.

Failures NestJS itself swallows or that this emitter swallows/propagates are
still also logged through NestJS's `Logger` (context
`InProcessDomainEventEmitter`) as before — point your existing observability
tool (Sentry) at those logs via a small custom `LoggerService` if you want
that too; the delivery log above is a separate, structured, queryable record.

## When to move to Model 2

A real broker transport — `domain-events.core.broker` — is warranted only once a
concrete signal (a second deployed service, a real cross-service integration)
makes it necessary. It has real design work first (at-least-once delivery,
idempotent consumers, transactional outbox, `emitCritical()`'s contract
changing meaning across a process boundary). See `domain-events.core.broker`.

## Depends on

`domain-events.core`, `@nestjs/common`, `@nestjs/core` (`DiscoveryService` /
`MetadataScanner` / `Reflector`, for the listener catalogue), `@nestjs/event-emitter`.
