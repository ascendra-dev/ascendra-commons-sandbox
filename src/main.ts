import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';

/** Headers a cross-origin browser client may read: the request id (Rule 7) and the CSV export's metadata (Rule 9). */
const EXPOSED_HEADERS = ['X-Request-Id', 'Content-Disposition', 'X-Export-Row-Count', 'X-Export-Truncated', 'X-Export-Limit'];

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3002').split(',').map((o) => o.trim()),
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Correlation-Id', 'Idempotency-Key'],
    exposedHeaders: EXPOSED_HEADERS,
  });
  const port = Number(process.env.PORT ?? 3010);
  await app.listen(port);
  console.log(`ascendra-commons-sandbox listening on http://localhost:${port}`);
}

void bootstrap();
