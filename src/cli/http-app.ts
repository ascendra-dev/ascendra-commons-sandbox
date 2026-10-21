import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module';
import { configureApp } from '../configure-app';

/**
 * The whole API, configured exactly as `main.ts` does, listening on a free local port — for the generators that
 * must go through HTTP (rate-limiting records only what its guard turns away).
 */
export async function startHttpApp(): Promise<{ app: NestExpressApplication; baseUrl: string }> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: await app.getUrl() };
}
