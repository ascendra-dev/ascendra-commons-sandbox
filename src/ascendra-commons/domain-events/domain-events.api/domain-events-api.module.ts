import { DynamicModule, Module } from '@nestjs/common';
import type { DomainEventsApiModuleConfig } from './domain-events-api.options';
import { DomainEventsApiService } from './domain-events-api.service';
import { DomainEventsController } from './domain-events.controller';

/**
 * HTTP read endpoints for an event-delivery admin screen, over
 * `EVENT_DELIVERY_OBSERVABILITY_PORT` and `EVENT_LISTENER_CATALOG_PORT`.
 * Opt-in, stack-agnostic — depends on the ports (brought in via `imports`),
 * never on a stack adapter directly. Read-only: deliveries are write-once and
 * the listener catalogue is a live read, so there is no mutation surface.
 *
 * Requires `AuthorizationGuard` wired globally as `APP_GUARD` — the endpoints
 * declare `@RequiresAction('domain-events.view')`.
 *
 * ```typescript
 * DomainEventsApiModule.forRoot({
 *   imports: [
 *     PostgresEventDeliveryObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
 *     // InProcessDomainEventEmitterModule.forRoot(...) exports EVENT_LISTENER_CATALOG_PORT — import it here too if it isn't otherwise visible.
 *   ],
 * })
 * ```
 */
@Module({})
export class DomainEventsApiModule {
  static forRoot(config: DomainEventsApiModuleConfig = {}): DynamicModule {
    return {
      module: DomainEventsApiModule,
      imports: config.imports ?? [],
      controllers: [DomainEventsController],
      providers: [DomainEventsApiService],
    };
  }
}
