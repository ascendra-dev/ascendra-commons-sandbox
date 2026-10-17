import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * AsyncLocalStorage, not a request-scoped NestJS provider — a request-scoped
 * provider only exists inside an actual HTTP request's DI context, which a
 * background job (background-jobs pattern) never has. AsyncLocalStorage
 * follows the async call chain itself, so it works identically whether the
 * chain started in an HTTP request or a scheduled job run.
 */
const correlationIdStorage = new AsyncLocalStorage<string>();

/**
 * Establishes the correlation id for everything called (directly or via
 * further async calls) inside fn — CorrelationIdMiddleware calls this once
 * per request; a background job's own wiring class should call it once per
 * run, so every audit record produced by that run shares one id rather than
 * each item's processItem() getting its own via the fallback below.
 */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationIdStorage.run(correlationId, fn);
}

/**
 * Returns the ambient correlation id if one was established via
 * runWithCorrelationId() anywhere up the current async call chain, otherwise
 * generates a fresh one — never undefined, regardless of whether this is
 * called from inside a request, inside a job run, or from neither.
 */
export function getCurrentCorrelationId(): string {
  return correlationIdStorage.getStore() ?? randomUUID();
}
