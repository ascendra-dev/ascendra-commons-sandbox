/**
 * Calendar days in a viewer's time zone, for the volume chart. Pure and stack-agnostic — duplicated (not shared)
 * from `audit-logging.core` so each module stays independently copyable.
 */
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

/** The `count` calendar days ending today in `timeZone`, oldest first, as `YYYY-MM-DD`. */
export function calendarDays(now: Date, count: number, timeZone: string): string[] {
  // en-CA formats a date as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  // Calendar arithmetic on the date itself (as a UTC midnight) — no zone offsets or DST involved.
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(todayMs - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** Each of `days` with its count from `counts` or `0` — a reader returns only the days that have rejections. */
export function fillDailyCounts(days: readonly string[], counts: ReadonlyMap<string, number>): Array<{ day: string; count: number }> {
  return days.map((day) => ({ day, count: counts.get(day) ?? 0 }));
}
