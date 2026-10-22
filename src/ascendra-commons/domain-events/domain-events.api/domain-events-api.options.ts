import type { DynamicModule } from '@nestjs/common';

/**
 * The `@RequiresAction` gate name `domain-events.api`'s endpoints declare.
 * Fixed — `@RequiresAction` is applied at class-definition time. Restrict this
 * to an ops / platform-admin persona (a delivery row is not tenant-scoped —
 * `domain-events` has no `tenantId`, same posture `background-jobs.api` takes).
 */
export const DOMAIN_EVENTS_ACTIONS = {
  /** Read the delivery log, the per-event catalog, and the listener catalogue. */
  VIEW: 'domain-events.view',
} as const;

export interface DomainEventsApiModuleConfig {
  /**
   * Modules exporting `EVENT_DELIVERY_OBSERVABILITY_PORT` (a stack adapter's
   * `PostgresEventDeliveryObservabilityModule`) and `EVENT_LISTENER_CATALOG_PORT`
   * (already exported by whichever `InProcessDomainEventEmitterModule` the app
   * wires — see that module's own README).
   */
  imports?: DynamicModule['imports'];
}
