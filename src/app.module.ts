import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { DatabaseModule } from './db/database.module';
import { DemoModule } from './demo/demo.module';
import { HealthController } from './health/health.controller';
import { CommonsModule } from './modules/commons/commons.module';

@Module({
  imports: [DatabaseModule, CommonsModule, AuthModule, DemoModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Every request gets a request id (api-contract Rule 7); CommonsModule adds the correlation id.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
