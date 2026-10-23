import { BadRequestException } from '@nestjs/common';

/**
 * Request validation for `authorization.api` — `ascendra-commons` carries no validation library. A caller's mistake is
 * a 400 naming what to fix, never a 500: an absent id would reach the database as NULL, a NUL byte fails Postgres'
 * `text`, `?limit=abc` arrives as NaN.
 */

/** Ids and names are short — a user id, a role id, an action, a tenant. */
const MAX_ID_LENGTH = 256;

export function idParam(name: string, value: unknown): string;
export function idParam(name: string, value: unknown, optional: true): string | undefined;
export function idParam(name: string, value: unknown, optional = false): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw new BadRequestException(`"${name}" is required`);
  }
  if (typeof value !== 'string') throw new BadRequestException(`"${name}" must be a string`);
  if (value.includes('\u0000')) throw new BadRequestException(`"${name}" must not contain a NUL byte`);
  if (value.length > MAX_ID_LENGTH) throw new BadRequestException(`"${name}" must be at most ${MAX_ID_LENGTH} characters`);
  return value;
}

/** Free text (a reason, a description) — bounded, no NUL. */
export function textParam(name: string, value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`"${name}" must be a string`);
  if (value.includes('\u0000')) throw new BadRequestException(`"${name}" must not contain a NUL byte`);
  if (value.length > max) throw new BadRequestException(`"${name}" must be at most ${max} characters`);
  return value;
}

/** A non-empty list of distinct ids. */
export function idListParam(name: string, value: unknown, max = 200): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new BadRequestException(`"${name}" must be a non-empty array`);
  if (value.length > max) throw new BadRequestException(`"${name}" may hold at most ${max} items`);
  return [...new Set(value.map((v, i) => idParam(`${name}[${i}]`, v)))];
}

export function dateParam(name: string, value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new BadRequestException(`"${name}" must be an ISO 8601 date-time`);
  return date;
}

/** A future date — an expiry. */
export function futureDateParam(name: string, value: unknown): Date | undefined {
  const date = dateParam(name, value);
  if (date && date.getTime() <= Date.now()) throw new BadRequestException(`"${name}" must be in the future`);
  return date;
}

export function positiveIntParam(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException(`"${name}" must be a positive whole number`);
  return n;
}

export function enumParam<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === '') return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException(`"${name}" must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

/** A flag — `true` or `false`; absent is `false`. Anything else (`1`, `TRUE`) is a 400, never a silently ignored filter. */
export function booleanParam(name: string, value: unknown): boolean {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new BadRequestException(`"${name}" must be true or false`);
}

/** `'7d'` or `'7'` → 7 (1–365); default 7. */
export function withinDaysParam(value: string | undefined): number {
  if (value === undefined || value === '') return 7;
  const match = /^(\d+)\s*d?$/i.exec(value.trim());
  const days = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new BadRequestException(`"within" must look like '7d' (1–365 days)`);
  return days;
}

/** api-contract.md Rule 4's cursor-based list shape. An absent `nextCursor` serializes as `meta: {}`. */
export function cursorList<T>(data: T[], nextCursor?: string) {
  return { data, meta: { nextCursor } };
}
