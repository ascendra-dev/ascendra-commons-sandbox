# `domain-events.api` — HTTP read endpoints for an event-delivery admin screen

Opt-in NestJS controller over `EVENT_DELIVERY_OBSERVABILITY_PORT` (the runtime
delivery log) and `EVENT_LISTENER_CATALOG_PORT` (the static "what listens to
what" wiring map). Stack-agnostic — it never imports a stack adapter; it's
wired to one at the vertical via `imports`. **Read-only** — deliveries are
write-once and the listener catalogue is a live read, so there's no mutation
surface and no admin emitter.

**Delivery only, never a listener outcome.** Every endpoint here answers "did
the event fire, and was anyone listening" — never "what happened after."
Whether a listener's own handling then succeeded (the audit record actually
wrote, the notification actually sent) is that listener's own module's
concern, surfaced through `audit-logging.api` / `notification.api`, not here.

## Endpoints

| Method | Path | → |
|---|---|---|
| GET | `/domain-events/deliveries` | `listDeliveries(DeliveryQuery)` — query params: `eventName`, `method`, `status`, `correlationId`, `since`, `until` (both on when the event occurred), `limit` (default 50, ≤ 200), `cursor`, `order` (`desc` default). Returns `{ data, meta: { nextCursor } }` (api-contract Rule 4). |
| GET | `/domain-events/deliveries/trace/:correlationId` | every delivery from one request / job run, oldest first, as `{ data, meta }` — a cross-module trace, joinable with `audit-logging.api`'s and `notification.api`'s own trace endpoints on the same id. |
| GET | `/domain-events/deliveries/summary` | `?since=` → total, delivered, no listeners, dispatch failed, critical (`emitCritical()`), distinct event names — the Overview's tiles. |
| GET | `/domain-events/deliveries/catalog` | `?since=` → one row per event name that fired, most first — total, `emit()` vs `emitCritical()` counts, no-listener and failed counts, the last occurrence and how many listeners it had. |
| GET | `/domain-events/deliveries/volume` | `?tz=` (IANA, default UTC) → deliveries per calendar day for 30 days (with no-listener / failed counts), zero-filled; the oldest stored delivery, row count, table size. |
| GET | `/domain-events/listener-catalog` | every `@OnEvent()`/`@OnCriticalEvent()` binding discovered in the running app — event name, listener class + method, whether critical. Independent of whether the event has ever fired. |

All gated on `@RequiresAction('domain-events.view')`; the controller also carries `AuthorizationEnforcedGuard`, so a
missing global guard is a 500 naming the fix, never an open log. No tenant scoping — `domain-events` has no
`tenantId`, same posture `background-jobs.api` takes. Every period is on when the event **occurred**.

A caller's mistake is a `400` naming the param, never a 500: a `since` / `until` that isn't an ISO 8601 date, a `limit`
that isn't a positive whole number, a `method` / `status` / `order` outside its values, a `tz` that isn't an IANA zone,
a NUL byte in any text, or a `cursor` this API didn't return.

## Reading the two catalogs together

`deliveries/catalog` (what has actually happened) and `listener-catalog` (what
the code says should happen) are deliberately separate reads, not
pre-joined — cross-referencing them client-side catches three different bugs:

- an event name in `listener-catalog` that never appears in `deliveries/catalog`
  — a listener wired to an event nobody ever raises (dead code, or a producer-side typo).
- an event name in `deliveries/catalog` with no matching entry in
  `listener-catalog` — the same signal `deliveries/catalog`'s own
  `noListenerCount` already gives per-delivery, confirmed independently by the
  static wiring map.
- an event with an `@OnCriticalEvent()` listener that `deliveries/catalog` shows raised with `emit()`
  (`emitCount > 0`) — the listener's failure is swallowed, the very mismatch the core README warns about.

## Wiring

```typescript
import { DomainEventsApiModule } from '.../domain-events.api';
import { PostgresEventDeliveryObservabilityModule } from '.../domain-events.core.postgres-drizzle';

@Module({
  imports: [
    DomainEventsApiModule.forRoot({
      imports: [
        PostgresEventDeliveryObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
        // InProcessDomainEventEmitterModule.forRoot(...) exports EVENT_LISTENER_CATALOG_PORT — import it here too if it isn't otherwise visible.
      ],
    }),
    { provide: APP_GUARD, useExisting: AuthorizationGuard },   // required
  ],
})
export class AppModule {}
```

## Depends on

`domain-events.core` (both ports + DTOs), and `authorization.core` (guard,
`@RequiresAction`). Never a stack adapter. The frontend belongs in
`ascendra-commons-ui`.
