import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { getCurrentCorrelationId } from '../../ascendra-commons/audit-logging/audit-logging.core';
import { DomainEventsModule } from '../../ascendra-commons/domain-events/domain-events.core';
import {
  IN_PROCESS_DOMAIN_EVENT_EMITTER,
  InProcessDomainEventEmitterModule,
} from '../../ascendra-commons/domain-events/domain-events.core.in-process';
import {
  POSTGRES_EVENT_DELIVERY_RECORDER,
  PostgresEventDeliveryObservabilityModule,
  PostgresEventDeliveryRecorderModule,
  PostgresEventDeliveryRetentionModule,
  PostgresEventDeliveryRetentionService,
} from '../../ascendra-commons/domain-events/domain-events.core.postgres-drizzle';
import { DomainEventsApiModule } from '../../ascendra-commons/domain-events/domain-events.api';
import { DATABASE_CONNECTION, DatabaseModule } from '../../db/database.module';

const application = process.env.APPLICATION ?? 'ascendra-commons-sandbox';

/**
 * The in-process transport, with the Postgres delivery log: every `emit()` / `emitCritical()` is recorded — buffered in
 * memory, written every 10s. One instance, imported below by both `domainEvents` and the read API, because it also
 * provides the listener catalogue (`EVENT_LISTENER_CATALOG_PORT`) the API reads. An emit made without a correlation id
 * takes the request's / job's — the one audit-logging's CorrelationIdMiddleware establishes — so audit's own events trace.
 */
const inProcessEmitter = InProcessDomainEventEmitterModule.forRoot({
  recorderToken: POSTGRES_EVENT_DELIVERY_RECORDER,
  correlationIdResolver: getCurrentCorrelationId,
  imports: [PostgresEventDeliveryRecorderModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] })],
});

/**
 * domain-events. Feature code injects `DOMAIN_EVENT_EMITTER`; audit-logging's shipped listener is reached through
 * `emitCritical()` on it, and the demo events (src/demo/demo-events.ts) through both methods.
 */
export const domainEvents = DomainEventsModule.forRoot({
  emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
  imports: [inProcessEmitter],
});

/** The read endpoints (`/domain-events/*`, gated by `domain-events.view`) over the delivery log and the listener catalogue. */
export const domainEventsApi = DomainEventsApiModule.forRoot({
  imports: [
    PostgresEventDeliveryObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] }),
    inProcessEmitter,
  ],
});

const RETENTION_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Retention is the consumer's (the module never prunes on its own). The sandbox has no scheduler yet, so this stands
 * in for one: prune at boot, then daily. A product runs `pruneDeliveries()` from its own scheduler — a background-jobs
 * `ScheduledJob` once that module is here.
 */
@Injectable()
class DomainEventRetentionTask implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('DomainEventRetention');
  private timer?: NodeJS.Timeout;

  constructor(@Inject(PostgresEventDeliveryRetentionService) private readonly retention: PostgresEventDeliveryRetentionService) {}

  onApplicationBootstrap() {
    void this.prune();
    this.timer = setInterval(() => void this.prune(), DAY);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private async prune() {
    try {
      const pruned = await this.retention.pruneDeliveries(new Date(Date.now() - RETENTION_DAYS * DAY));
      if (pruned > 0) this.logger.log(`Pruned ${pruned} event delivery(ies) older than ${RETENTION_DAYS} days`);
    } catch (err) {
      this.logger.error('Domain-event retention failed', err instanceof Error ? err.stack : String(err));
    }
  }
}

@Module({
  imports: [PostgresEventDeliveryRetentionModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] })],
  providers: [DomainEventRetentionTask],
})
export class DomainEventRetentionModule {}
