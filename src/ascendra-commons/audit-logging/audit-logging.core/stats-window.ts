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

/** Whether `timeZone` is an IANA zone this runtime knows (e.g. `'Asia/Dubai'`, `'UTC'`). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar dates (`YYYY-MM-DD`) of the past `days` days in `timeZone` — the `days` before today and today, oldest
 * first. Whole local days, so a chart's first bar is a full day like the rest (a `now − days` instant would cut it);
 * only today is "so far". The viewer's zone, so a bar is the same day their calendar shows.
 */
export function calendarDays(now: Date, days: number, timeZone: string): string[] {
  // en-CA formats a date as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  // Calendar arithmetic on the date itself (as a UTC midnight) — no zone offsets or DST involved.
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days + 1 }, (_, i) => new Date(todayMs - (days - i) * DAY_MS).toISOString().slice(0, 10));
}

/**
 * Each of `days` (`YYYY-MM-DD`, see `calendarDays`) with its count from `counts` or `0` — so a chart over the window
 * spans all of it, quiet days included. A reader returns only the days that have records; this fills the rest.
 */
export function fillDailyCounts(days: readonly string[], counts: ReadonlyMap<string, number>): Array<{ day: string; count: number }> {
  return days.map((day) => ({ day, count: counts.get(day) ?? 0 }));
}

/**
 * Every UTC month from `first`'s through `now`'s, oldest first, with each month's count from `counts` (`YYYY-MM` →
 * count) or `0`. Empty when `first` is `null` (no records yet).
 */
export function fillMonthlyCounts(first: Date | null, now: Date, counts: ReadonlyMap<string, number>): Array<{ month: string; count: number }> {
  if (!first) return [];
  const out: Array<{ month: string; count: number }> = [];
  // Months as one running number (year * 12 + month), so a year end needs no special case.
  const last = now.getUTCFullYear() * 12 + now.getUTCMonth();
  for (let i = first.getUTCFullYear() * 12 + first.getUTCMonth(); i <= last; i++) {
    const month = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
    out.push({ month, count: counts.get(month) ?? 0 });
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
