import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CorrelationIdMiddleware } from '../../ascendra-commons/audit-logging/audit-logging.core';
import { auditApi, auditLogging } from './audit-logging';
import { authorization } from './authorization';
import { domainEvents } from './domain-events';
import { RateLimitRetentionModule, rateLimiting, rateLimitingApi, throttler } from './rate-limiting';

/**
 * Every ascendra-commons module this app uses, configured in one place — what any consuming project writes (see
 * ascendra-commons' README, "Integrating into a project"). One file per module; AppModule imports only this.
 * The vendored code itself lives in src/ascendra-commons and is never edited.
 */
@Module({
  imports: [domainEvents, authorization, auditLogging, auditApi, throttler, rateLimiting, rateLimitingApi, RateLimitRetentionModule],
  exports: [domainEvents, authorization, rateLimiting],
})
export class CommonsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // The correlation id audit records are grouped by in a trace — on every request.
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
