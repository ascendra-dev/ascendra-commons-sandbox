import { DomainEventsModule } from '../../ascendra-commons/domain-events/domain-events.core';
import {
  IN_PROCESS_DOMAIN_EVENT_EMITTER,
  InProcessDomainEventEmitterModule,
} from '../../ascendra-commons/domain-events/domain-events.core.in-process';

/**
 * domain-events with the in-process transport. Feature code injects `DOMAIN_EVENT_EMITTER`; audit-logging's shipped
 * listener is reached through `emitCritical()` on it.
 */
export const domainEvents = DomainEventsModule.forRoot({
  emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
  imports: [InProcessDomainEventEmitterModule.forRoot()],
});
