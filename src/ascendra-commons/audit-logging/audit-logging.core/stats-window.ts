/**
 * Parses the `window` param the Overview screen's `GET /audit/stats?window=30d`
 * takes (see `AuditEventReader.stats`) into a concrete lookback. Pure and
 * stack-agnostic — a reader implementation turns `since` into `occurred_at >=
 * $1`; it never parses the string itself.
 *
 * `now` is a parameter (defaulting to `new Date()`) rather than read directly,
 * so this stays a pure function under test.
 */
const WINDOW_PATTERN = /^(\d+)d$/;

export interface StatsWindow {
  /** Normalized label, e.g. `'30d'` — echoed back in `AuditStats.window`. */
  label: string;
  days: number;
  since: Date;
}

export function parseStatsWindow(
  window: string | undefined,
  now: Date = new Date(),
  defaultDays = 30,
  maxDays = 365,
): StatsWindow {
  const match = window ? WINDOW_PATTERN.exec(window) : null;
  const days = match ? Math.min(Math.max(1, Number(match[1])), maxDays) : defaultDays;
  return { label: `${days}d`, days, since: new Date(now.getTime() - days * 24 * 60 * 60 * 1000) };
}
