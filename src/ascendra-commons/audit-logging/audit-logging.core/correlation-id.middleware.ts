import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { runWithCorrelationId } from './correlation-context';

/**
 * Deliberately not typed against express's Request — just the one header this
 * middleware actually reads, so this library never needs express as a
 * dependency just for types (the same reasoning SqlExecutor uses in the
 * background-jobs pattern to avoid depending on a consumer's full Drizzle
 * schema).
 */
interface MinimalRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Wire this once, globally, ahead of any route that raises an auditable
 * event — e.g. `app.use(new CorrelationIdMiddleware().use.bind(...))` or via
 * NestJS's own MiddlewareConsumer. Reuses an inbound x-correlation-id header
 * if the caller already has one (letting a correlation id span multiple
 * services), otherwise generates a fresh one per request.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: MinimalRequest, _res: unknown, next: (error?: unknown) => void): void {
    const header = req.headers['x-correlation-id'];
    const correlationId = (typeof header === 'string' ? header : undefined) ?? randomUUID();
    runWithCorrelationId(correlationId, next);
  }
}
