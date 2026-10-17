import { describe, expect, it } from 'vitest';
import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { getCurrentCorrelationId } from './correlation-context';

describe('CorrelationIdMiddleware', () => {
  it('reuses an inbound x-correlation-id header', () => {
    const middleware = new CorrelationIdMiddleware();
    let seen: string | undefined;

    middleware.use({ headers: { 'x-correlation-id': 'from-upstream' } }, {}, () => {
      seen = getCurrentCorrelationId();
    });

    expect(seen).toBe('from-upstream');
  });

  it('generates a fresh id when no header is present', () => {
    const middleware = new CorrelationIdMiddleware();
    let seen: string | undefined;

    middleware.use({ headers: {} }, {}, () => {
      seen = getCurrentCorrelationId();
    });

    expect(seen).toBeTruthy();
  });

  it('ignores a non-string header value (e.g. a duplicated header parsed as an array) and generates a fresh id instead', () => {
    const middleware = new CorrelationIdMiddleware();
    let seen: string | undefined;

    middleware.use({ headers: { 'x-correlation-id': ['a', 'b'] } }, {}, () => {
      seen = getCurrentCorrelationId();
    });

    expect(seen).toBeTruthy();
    expect(seen).not.toEqual(['a', 'b']);
  });

  it('the same id is visible for the whole handler, not just the entry point', () => {
    const middleware = new CorrelationIdMiddleware();
    const seen: string[] = [];

    middleware.use({ headers: { 'x-correlation-id': 'stable-id' } }, {}, () => {
      seen.push(getCurrentCorrelationId());
      seen.push(getCurrentCorrelationId());
    });

    expect(seen).toEqual(['stable-id', 'stable-id']);
  });
});
