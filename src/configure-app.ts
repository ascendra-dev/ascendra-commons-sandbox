import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiExceptionFilter } from './common/api-exception.filter';

/** Headers a cross-origin browser client may read: the request id (Rule 7) and the CSV export's metadata (Rule 9). */
const EXPOSED_HEADERS = ['X-Request-Id', 'Content-Disposition', 'X-Export-Row-Count', 'X-Export-Truncated', 'X-Export-Limit'];

/** Everything the HTTP app needs beyond its modules — shared by `main.ts` and the CLI that drives it over HTTP. */
export function configureApp(app: NestExpressApplication) {
  // One proxy in front: the testbed's Next rewrite (/sandbox-api), and a load balancer in a real deployment. Without
  // this, req.ip is the proxy and every caller shares one rate-limit counter; `true` would trust a client-supplied
  // X-Forwarded-For and let a flood pick a fresh "IP" per request.
  app.set('trust proxy', 1);
  app.enableShutdownHooks();
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3002').split(',').map((o) => o.trim()),
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Correlation-Id', 'Idempotency-Key'],
    exposedHeaders: EXPOSED_HEADERS,
  });
}
