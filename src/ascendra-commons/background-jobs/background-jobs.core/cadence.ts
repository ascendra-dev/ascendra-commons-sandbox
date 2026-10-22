/**
 * Cadence hints for job-observability reporting. A cadence is a rough "if it hasn't
 * run in this long, something is wrong" bound — NOT the job's real cron
 * expression, which the adapter never sees. `'1d'` / `'2h'` / `'30m'` / `'90s'`,
 * or a plain number of seconds.
 */

export interface ParsedCadence {
  seconds: number;
  /** Human form, e.g. "1 day". */
  label: string;
}

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Throws on nonsense — a typo in `forRoot({ cadences })` should fail loudly at startup, not silently disable overdue detection. */
export function parseCadence(input: string | number): ParsedCadence {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) throw new Error(`Invalid cadence: ${input} — expected a positive number of seconds.`);
    return { seconds: Math.round(input), label: humanizeDuration(input) };
  }
  const match = /^(\d+)\s*([smhd])$/.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid cadence "${input}" — use e.g. '1d', '2h', '30m', '90s', or a number of seconds.`);
  }
  const seconds = Number(match[1]) * UNIT_SECONDS[match[2]];
  if (seconds <= 0) throw new Error(`Invalid cadence "${input}".`);
  return { seconds, label: humanizeDuration(seconds) };
}

/** Rough, single-unit: "2 days" / "3 hours" / "45 minutes" / "20 seconds". For UI display, not precision. */
export function humanizeDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const days = Math.floor(s / 86400);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(s / 3600);
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const minutes = Math.floor(s / 60);
  if (minutes >= 1) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${s} second${s === 1 ? '' : 's'}`;
}
