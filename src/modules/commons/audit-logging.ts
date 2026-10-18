import { AuditLoggingModule } from '../../ascendra-commons/audit-logging/audit-logging.core';
import {
  POSTGRES_AUDIT_EVENT_REPOSITORY,
  PostgresAuditObservabilityModule,
  PostgresAuditPersistenceModule,
} from '../../ascendra-commons/audit-logging/audit-logging.core.postgres-drizzle';
import { AuditApiModule } from '../../ascendra-commons/audit-logging/audit-logging.api';
import { DATABASE_CONNECTION, DatabaseModule } from '../../db/database.module';
import { AUDIT_CATALOG } from './audit-catalog';

const application = process.env.APPLICATION ?? 'ascendra-commons-sandbox';

/**
 * audit-logging, wired the way its README prescribes: `AuditRecordRaised` (via domain-events) reaches the shipped
 * AuditListener, which writes through the Postgres repository on this app's database connection.
 */
export const auditLogging = AuditLoggingModule.forRoot({
  auditEventRepositoryToken: POSTGRES_AUDIT_EVENT_REPOSITORY,
  imports: [PostgresAuditPersistenceModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] })],
});

/** The read endpoints (`/audit/*`, gated by `audit.view`) over the Postgres reader, with this app's audit catalog. */
export const auditApi = AuditApiModule.forRoot({
  catalog: AUDIT_CATALOG,
  imports: [PostgresAuditObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] })],
});
