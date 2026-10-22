import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CorrelationIdMiddleware } from '../../ascendra-commons/audit-logging/audit-logging.core';
import { auditApi, auditLogging } from './audit-logging';
import { authorization } from './authorization';
import { JobSchedulesModule, backgroundJobs, backgroundJobsApi } from './background-jobs';
import { domainEvents, domainEventsApi } from './domain-events';
import { idempotency, idempotencyApi } from './idempotency';
import { rateLimiting, rateLimitingApi, throttler } from './rate-limiting';

/**
 * Every ascendra-commons module this app uses, configured in one place — what any consuming project writes (see
 * ascendra-commons' README, "Integrating into a project"). One file per module; AppModule imports only this.
 * The vendored code itself lives in src/ascendra-commons and is never edited.
 */
@Module({
  imports: [
    domainEvents, domainEventsApi, authorization, auditLogging, auditApi,
    throttler, rateLimiting, rateLimitingApi,
    idempotency, idempotencyApi,
    // The retention / cleanup jobs of the modules above run here too — as scheduled jobs (background-jobs.ts).
    backgroundJobs, backgroundJobsApi, JobSchedulesModule,
  ],
  exports: [domainEvents, authorization, rateLimiting, idempotency, backgroundJobs],
})
export class CommonsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // The correlation id audit records are grouped by in a trace — on every request.
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
