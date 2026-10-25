import { BadRequestException } from '@nestjs/common';

/**
 * Request validation for `notification.api` — `ascendra-commons` carries no validation library. A caller's mistake is
 * a 400 naming what to fix, never a 500: an Invalid Date only fails when the driver serializes it, `?limit=abc`
 * arrives as NaN, a NUL byte fails Postgres' `text`. Duplicated from `authorization.api` so the module stays copyable.
 */

/** Ids and names are short — a notification type, a tenant, a recipient ref. */
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

/** A tenant in a body — a tenant id, or `null` for the deployment default. Absent is a 400: say which you mean. */
export function tenantParam(name: string, value: unknown): string | null {
  if (value === null) return null;
  if (value === undefined) throw new BadRequestException(`"${name}" is required — a tenant id, or null for the default`);
  return idParam(name, value);
}

/** Free text (a template body, a subject) — bounded, no NUL. */
export function textParam(name: string, value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`"${name}" must be a string`);
  if (value.includes('\u0000')) throw new BadRequestException(`"${name}" must not contain a NUL byte`);
  if (value.length > max) throw new BadRequestException(`"${name}" must be at most ${max} characters`);
  return value;
}

export function dateParam(name: string, value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new BadRequestException(`"${name}" must be an ISO 8601 date-time`);
  return date;
}

export function positiveIntParam(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException(`"${name}" must be a positive whole number`);
  return n;
}

export function enumParam<T extends string>(name: string, value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException(`"${name}" must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

export function booleanParam(name: string, value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new BadRequestException(`"${name}" must be true or false`);
  return value;
}

/** A query flag — the strings `true` / `false`; anything else (`1`, `TRUE`) is a 400, never a silently ignored filter. */
export function flagParam(name: string, value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException(`"${name}" must be true or false`);
}

/** A plain JSON object — `{ ... }`, not an array or a scalar. */
export function objectParam(name: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException(`"${name}" must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/** Template variables — an object of strings and numbers. */
export function variablesParam(name: string, value: unknown): Record<string, string | number> {
  if (value === undefined || value === null) return {};
  const obj = objectParam(name, value);
  for (const [key, v] of Object.entries(obj)) {
    if (typeof v !== 'string' && typeof v !== 'number') {
      throw new BadRequestException(`"${name}.${key}" must be a string or a number`);
    }
  }
  return obj as Record<string, string | number>;
}

/** A correlation id worth matching — the same rule every module stores one by. */
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
export function correlationIdParam(name: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !CORRELATION_ID.test(value)) {
    throw new BadRequestException(`"${name}" must be 1–128 letters, digits or . _ : -`);
  }
  return value;
}

/** api-contract.md Rule 4's cursor-based list shape. An absent `nextCursor` serializes as `meta: {}`. */
export function cursorList<T>(data: T[], nextCursor?: string) {
  return { data, meta: { nextCursor } };
}
