import { Module } from '@nestjs/common';
import { CommonsModule } from '../modules/commons/commons.module';
import { DemoController } from './demo.controller';
import { IdempotentDemoController } from './idempotent-demo.controller';

/**
 * Sandbox-only stand-in endpoints: throttled ones for the rate-limit generator, idempotent ones for the idempotency
 * generator. Imports CommonsModule for `IdempotencyInterceptor`.
 */
@Module({ imports: [CommonsModule], controllers: [DemoController, IdempotentDemoController] })
export class DemoModule {}
