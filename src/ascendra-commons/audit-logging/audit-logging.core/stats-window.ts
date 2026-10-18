/**
 * Parses the `window` param the Overview screen's `GET /audit/stats/overview?window=30d`
 * and `/stats/top-actions` take (see `AuditEventReader.overviewStats`) into a concrete lookback. Pure and
 * stack-agnostic — a reader implementation turns `since` into `occurred_at >=
 * $1`; it never parses the string itself.
 *
 * `now` is a parameter (defaulting to `new Date()`) rather than read directly,
 * so this stays a pure function under test.
 */
const WINDOW_PATTERN = /^(\d+)d$/;

export interface StatsWindow {
  /** Normalized label, e.g. `'30d'` — echoed back as the stats response's `window`. */
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every UTC day from `since`'s through `now`'s, oldest first, with each day's count from `counts` (`YYYY-MM-DD` →
 * count) or `0` — so a chart over the window spans all of it, quiet days included. A reader returns only the days
 * that have records; this fills the rest.
 */
export function fillDailyCounts(since: Date, now: Date, counts: ReadonlyMap<string, number>): Array<{ day: string; count: number }> {
  const out: Array<{ day: string; count: number }> = [];
  const first = Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate());
  for (let t = first; t <= now.getTime(); t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, count: counts.get(day) ?? 0 });
  }
  return out;
}

/**
 * A KPI against the equal period before it: percent change to one decimal, or `null` when the prior period was
 * empty — "+100%" (or "+∞") from zero says nothing useful, so the screen shows "new" instead.
 */
export function kpiValue(current: number, prior: number): { value: number; deltaPct: number | null } {
  return { value: current, deltaPct: prior === 0 ? null : Math.round(((current - prior) / prior) * 1000) / 10 };
}
