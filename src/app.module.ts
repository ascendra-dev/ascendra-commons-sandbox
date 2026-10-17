import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CorrelationIdMiddleware } from './ascendra-commons/audit-logging/audit-logging.core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { DatabaseModule } from './db/database.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Every request gets a request id (Rule 7) and a correlation id (what audit records are grouped by in a trace).
    consumer.apply(RequestIdMiddleware, CorrelationIdMiddleware).forRoutes('*');
  }
}
