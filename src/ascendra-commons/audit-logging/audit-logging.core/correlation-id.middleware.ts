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
 * What an inbound id may look like: 1–128 of letters, digits, `.`, `_`, `:` and `-` — a UUID, a W3C trace id, the
 * usual tracing formats. Anything else (overlong, spaces, control characters, markup) is the caller's own text, and
 * it would be stored on every audit record of the request — so it's replaced, not kept.
 */
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Wire this once, globally, ahead of any route that raises an auditable
 * event — e.g. `app.use(new CorrelationIdMiddleware().use.bind(...))` or via
 * NestJS's own MiddlewareConsumer. Reuses a well-formed inbound x-correlation-id
 * header (letting a correlation id span multiple services), otherwise generates a
 * fresh one per request.
 *
 * A well-formed id is still the caller's choice — a client could send another
 * request's id and land its records in that trace. Trust the header only from your
 * own services: at a public edge, strip it (or set it) in the gateway.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: MinimalRequest, _res: unknown, next: (error?: unknown) => void): void {
    const header = req.headers['x-correlation-id'];
    const correlationId = typeof header === 'string' && CORRELATION_ID.test(header) ? header : randomUUID();
    runWithCorrelationId(correlationId, next);
  }
}
