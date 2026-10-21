import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';

/** Throttled stand-in endpoints for the rate-limit generator — sandbox-only. */
@Module({ controllers: [DemoController] })
export class DemoModule {}
