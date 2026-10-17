import { describe, expect, it } from 'vitest';
import { parseStatsWindow } from './stats-window';

const now = new Date('2026-09-13T00:00:00Z');

describe('parseStatsWindow', () => {
  it('parses a "<n>d" window relative to now', () => {
    expect(parseStatsWindow('7d', now)).toEqual({
      label: '7d',
      days: 7,
      since: new Date('2026-09-06T00:00:00Z'),
    });
  });

  it('defaults to 30 days when window is omitted or unparseable', () => {
    expect(parseStatsWindow(undefined, now)).toEqual({ label: '30d', days: 30, since: new Date('2026-08-14T00:00:00Z') });
    expect(parseStatsWindow('garbage', now)).toEqual({ label: '30d', days: 30, since: new Date('2026-08-14T00:00:00Z') });
    expect(parseStatsWindow('30days', now).days).toBe(30);
  });

  it('caps the window at maxDays', () => {
    expect(parseStatsWindow('9999d', now, 30, 365).days).toBe(365);
  });

  it('floors at 1 day', () => {
    expect(parseStatsWindow('0d', now).days).toBe(1);
  });
});
