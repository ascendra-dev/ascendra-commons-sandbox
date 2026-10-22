import { Module } from '@nestjs/common';
import { CommonsModule } from '../modules/commons/commons.module';
import { DemoController } from './demo.controller';
import { DEMO_EVENT_LISTENERS } from './demo-events';
import { IdempotentDemoController } from './idempotent-demo.controller';

/**
 * Sandbox-only stand-ins: throttled endpoints for the rate-limit generator, idempotent ones for the idempotency
 * generator, and domain-event listeners for the domain-events one (demo-events.ts). Imports CommonsModule for
 * `IdempotencyInterceptor`.
 */
@Module({ imports: [CommonsModule], controllers: [DemoController, IdempotentDemoController], providers: [...DEMO_EVENT_LISTENERS] })
export class DemoModule {}
