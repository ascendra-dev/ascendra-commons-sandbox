import { Module } from '@nestjs/common';
import { DomainEventsModule } from '../ascendra-commons/domain-events/domain-events.core';
import {
  IN_PROCESS_DOMAIN_EVENT_EMITTER,
  InProcessDomainEventEmitterModule,
} from '../ascendra-commons/domain-events/domain-events.core.in-process';
import { AuditLoggingModule } from '../ascendra-commons/audit-logging/audit-logging.core';
import {
  POSTGRES_AUDIT_EVENT_REPOSITORY,
  PostgresAuditObservabilityModule,
  PostgresAuditPersistenceModule,
} from '../ascendra-commons/audit-logging/audit-logging.core.postgres-drizzle';
import { AuditApiModule } from '../ascendra-commons/audit-logging/audit-logging.api';
import { DATABASE_CONNECTION, DatabaseModule } from '../db/database.module';
import { AUDIT_CATALOG } from './audit-catalog';

const application = process.env.APPLICATION ?? 'ascendra-commons-sandbox';

/**
 * audit-logging, wired the way its README prescribes: domain events (in-process) carry `AuditRecordRaised` to the
 * shipped AuditListener, which writes through the Postgres repository; `AuditApiModule` serves the read endpoints
 * (`/audit/*`, gated by `audit.view`) over the Postgres reader.
 */
@Module({
  imports: [
    DomainEventsModule.forRoot({
      emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER,
      imports: [InProcessDomainEventEmitterModule.forRoot()],
    }),
    AuditLoggingModule.forRoot({
      auditEventRepositoryToken: POSTGRES_AUDIT_EVENT_REPOSITORY,
      imports: [PostgresAuditPersistenceModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] })],
    }),
    AuditApiModule.forRoot({
      catalog: AUDIT_CATALOG,
      imports: [PostgresAuditObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] })],
    }),
  ],
  exports: [DomainEventsModule],
})
export class AuditModule {}
