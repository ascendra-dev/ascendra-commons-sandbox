import { DynamicModule, Module, Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EVENT_DELIVERY_RECORDER, EVENT_LISTENER_CATALOG_PORT, NoopEventDeliveryRecorder } from '../domain-events.core';
import { InProcessDomainEventEmitter } from './in-process-domain-event-emitter.service';
import { DomainEventListenerCatalog } from './domain-event-listener-catalog.service';
import { DOMAIN_EVENT_CORRELATION_ID_RESOLVER, IN_PROCESS_DOMAIN_EVENT_EMITTER, type CorrelationIdResolver } from './tokens';

export interface InProcessDomainEventEmitterModuleConfig {
  /**
   * Token an `EventDeliveryRecorder` implementation is provided under (e.g.
   * `POSTGRES_EVENT_DELIVERY_RECORDER`). Omit and the delivery log is a no-op
   * (`NoopEventDeliveryRecorder`) — the emitter still works exactly as before,
   * just without a delivery log.
   */
  recorderToken?: string | symbol | (new (...args: never[]) => unknown);
  /** Whatever module(s) export the provider behind `recorderToken`. */
  imports?: DynamicModule['imports'];
  /**
   * The app's ambient correlation id, used when a producer calls `emit()` / `emitCritical()` without one — so events
   * raised inside a request or job trace with it, without every producer threading the id through. Typically the same
   * context the app's other modules read, e.g. audit-logging's `getCurrentCorrelationId` (this module never imports
   * it). An explicit third argument always wins; a resolver that throws or returns nothing leaves the delivery
   * without one.
   */
  correlationIdResolver?: CorrelationIdResolver;
}

/**
 * Model 1 wiring. Provides `InProcessDomainEventEmitter` and exports it under
 * `IN_PROCESS_DOMAIN_EVENT_EMITTER`, plus `DomainEventListenerCatalog` under
 * `EVENT_LISTENER_CATALOG_PORT` (the wiring-map read — see that service's own
 * doc comment for why only Model 1 can provide one).
 *
 * ```typescript
 * DomainEventsModule.forRoot({
 *   emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
 *   imports: [
 *     InProcessDomainEventEmitterModule.forRoot({
 *       recorderToken: POSTGRES_EVENT_DELIVERY_RECORDER, // optional
 *       imports: [PostgresEventDeliveryRecorderModule.forRoot({ ... })],
 *     }),
 *   ],
 * })
 * ```
 *
 * **`{ global: false }`:** `EventEmitterModule.forRoot()` defaults to
 * `global: true`, which would let any module inject the raw `EventEmitter2`
 * directly and bypass `emit()` / `emitCritical()`'s reliability tiering.
 * `{ global: false }` scopes `EventEmitter2` to this package's importers. It
 * does **not** affect `@OnEvent()` / `@OnCriticalEvent()` listener discovery —
 * `EventSubscribersLoader` scans every provider via `DiscoveryService`
 * regardless of any module's `global` setting.
 */
@Module({})
export class InProcessDomainEventEmitterModule {
  static forRoot(config: InProcessDomainEventEmitterModuleConfig = {}): DynamicModule {
    const recorderProvider: Provider = config.recorderToken
      ? { provide: EVENT_DELIVERY_RECORDER, useExisting: config.recorderToken }
      : { provide: EVENT_DELIVERY_RECORDER, useClass: NoopEventDeliveryRecorder };

    return {
      module: InProcessDomainEventEmitterModule,
      imports: [EventEmitterModule.forRoot({ global: false }), DiscoveryModule, ...(config.imports ?? [])],
      providers: [
        recorderProvider,
        ...(config.correlationIdResolver
          ? [{ provide: DOMAIN_EVENT_CORRELATION_ID_RESOLVER, useValue: config.correlationIdResolver }]
          : []),
        InProcessDomainEventEmitter,
        { provide: IN_PROCESS_DOMAIN_EVENT_EMITTER, useExisting: InProcessDomainEventEmitter },
        DomainEventListenerCatalog,
        { provide: EVENT_LISTENER_CATALOG_PORT, useExisting: DomainEventListenerCatalog },
      ],
      exports: [IN_PROCESS_DOMAIN_EVENT_EMITTER, EVENT_LISTENER_CATALOG_PORT],
    };
  }
}
