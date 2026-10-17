import { describe, expect, it } from 'vitest';
import { getCurrentCorrelationId, runWithCorrelationId } from './correlation-context';

describe('correlation-context', () => {
  it('returns the ambient id when called inside runWithCorrelationId', () => {
    runWithCorrelationId('corr-1', () => {
      expect(getCurrentCorrelationId()).toBe('corr-1');
    });
  });

  it('returns the ambient id across further async calls inside the same context, never undefined', async () => {
    await runWithCorrelationId('corr-2', async () => {
      await Promise.resolve();
      expect(getCurrentCorrelationId()).toBe('corr-2');
    });
  });

  it('generates a fresh id, never undefined, when called outside any context', () => {
    const id = getCurrentCorrelationId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('generates a different fresh id on each outside-context call', () => {
    expect(getCurrentCorrelationId()).not.toBe(getCurrentCorrelationId());
  });

  it('does not leak between two concurrent contexts — the AsyncLocalStorage property this whole mechanism depends on', async () => {
    const seenInA: string[] = [];
    const seenInB: string[] = [];

    await Promise.all([
      runWithCorrelationId('context-a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seenInA.push(getCurrentCorrelationId());
      }),
      runWithCorrelationId('context-b', async () => {
        seenInB.push(getCurrentCorrelationId());
      }),
    ]);

    expect(seenInA).toEqual(['context-a']);
    expect(seenInB).toEqual(['context-b']);
  });

  it('nested runWithCorrelationId shadows the outer id only within the inner scope', () => {
    runWithCorrelationId('outer', () => {
      expect(getCurrentCorrelationId()).toBe('outer');
      runWithCorrelationId('inner', () => {
        expect(getCurrentCorrelationId()).toBe('inner');
      });
      expect(getCurrentCorrelationId()).toBe('outer');
    });
  });
});
