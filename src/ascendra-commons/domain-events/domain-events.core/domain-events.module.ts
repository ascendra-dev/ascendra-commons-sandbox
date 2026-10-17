import { DynamicModule, Module } from '@nestjs/common';
import { DOMAIN_EVENT_EMITTER } from './tokens';

export interface DomainEventsModuleConfig {
  /**
   * The injection token a `DomainEventEmitter` implementation is provided under
   * by a module in `imports`. `useExisting`-aliased to `DOMAIN_EVENT_EMITTER`,
   * so every call site (`@Inject(DOMAIN_EVENT_EMITTER)`) is unaffected by which
   * transport is bound.
   *
   *   - Model 1: `IN_PROCESS_DOMAIN_EVENT_EMITTER` (domain-events.core.in-process)
   *   - Model 2: `BROKER_DOMAIN_EVENT_EMITTER` (domain-events.core.broker) — wires,
   *     but throws `BrokerTransportNotImplementedError` on first use
   *   - or your own transport on another mechanism.
   */
  emitterToken: string | symbol | (new (...args: never[]) => unknown);
  /**
   * Whatever module(s) export the provider behind `emitterToken`. `useExisting`
   * only resolves a token NestJS can already see in *this* module's own
   * providers or imports.
   */
  imports?: DynamicModule['imports'];
}

/**
 * The transport-agnostic core. `forRoot()` is pure token wiring — it aliases
 * `DOMAIN_EVENT_EMITTER` to `emitterToken` and nothing else. The transport is
 * chosen by which module you put in `imports`; both Model 1 and Model 2 wire
 * identically.
 *
 * Business logic injects `DOMAIN_EVENT_EMITTER` and calls `emit()` /
 * `emitCritical()` — it never learns which transport is bound. The listener side
 * (`@OnEvent()` / `@OnCriticalEvent()`) is *not* transport-agnostic — see this
 * package's README and `on-critical-event.decorator.ts`.
 */
@Module({})
export class DomainEventsModule {
  static forRoot(config: DomainEventsModuleConfig): DynamicModule {
    if (!config?.emitterToken) {
      throw new Error(
        'DomainEventsModule.forRoot() requires emitterToken — IN_PROCESS_DOMAIN_EVENT_EMITTER from ' +
          'domain-events.core.in-process (Model 1), BROKER_DOMAIN_EVENT_EMITTER from ' +
          'domain-events.core.broker (Model 2), or your own transport token.',
      );
    }

    return {
      module: DomainEventsModule,
      imports: config.imports ?? [],
      providers: [{ provide: DOMAIN_EVENT_EMITTER, useExisting: config.emitterToken }],
      exports: [DOMAIN_EVENT_EMITTER],
    };
  }
}
