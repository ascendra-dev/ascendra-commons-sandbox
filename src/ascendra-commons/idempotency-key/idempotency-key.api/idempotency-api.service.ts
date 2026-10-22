import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  IDEMPOTENCY_OBSERVABILITY_PORT,
  InvalidIdempotencyCursorError,
  type CachedResponse,
  type ClaimHealthSummary,
  type ClaimPage,
  type IdempotencyClaimRecord,
  type IdempotencyObservabilityPort,
  type RouteClaimCount,
} from '../idempotency-key.core';
import type { ClaimQueryDto } from './dto/idempotency-api.dto';

/**
 * A date query param as a Date — a 400 when it isn't one. Unchecked, `new Date('yesterday')` is an Invalid Date that
 * only fails when the driver serializes it: a 500 for what is the caller's mistake.
 */
function dateParam(name: string, value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`"${name}" must be an ISO 8601 date or date-time`);
  return date;
}

/** `limit` as given — a 400 unless it's a positive whole number (`?limit=abc` arrives as NaN). Adapters cap it. */
function limitParam(value: number | undefined): number | undefined {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new BadRequestException('"limit" must be a positive whole number');
  }
  return value;
}

/**
 * A text param as given — a 400 if it holds a NUL byte, which Postgres can't store in `text` and rejects as an
 * encoding error: a 500 for a malformed id.
 */
function textParam(name: string, value: string | undefined): string | undefined {
  if (value?.includes('\u0000')) throw new BadRequestException(`"${name}" must not contain a NUL byte`);
  return value;
}

const STATUSES = ['pending', 'completed'] as const;

/** `status` as given — a 400 unless it's one the store has; an unknown one would match nothing and look like "none". */
function statusParam(value: string | undefined): ClaimQueryDto['status'] {
  if (value !== undefined && !(STATUSES as readonly string[]).includes(value)) {
    throw new BadRequestException(`"status" must be one of ${STATUSES.join(', ')}`);
  }
  return value as ClaimQueryDto['status'];
}

/**
 * Thin orchestration over `IdempotencyObservabilityPort`. No tenant scoping —
 * `scope` is opaque to this module (whatever the app's own
 * `IdempotencyScopeResolver` returns), so there is no safe generic way to
 * auto-restrict a caller to "their own" scope the way `audit-logging.api` does
 * for `tenantId`. Gate `idempotency.view` to an ops/support persona instead —
 * see the module README. Params are validated here — a bad date, limit,
 * status or cursor, or a NUL byte in any text, is a 400, never a 500; a claim
 * (or saved response) that isn't there is a 404. No mutation surface — claims are written only
 * by `IdempotencyStore`.
 */
@Injectable()
export class IdempotencyApiService {
  constructor(@Inject(IDEMPOTENCY_OBSERVABILITY_PORT) private readonly observability: IdempotencyObservabilityPort) {}

  async getClaim(key: string, scope: string): Promise<IdempotencyClaimRecord> {
    const claim = await this.observability.getClaim(textParam('key', key) as string, textParam('scope', scope) as string);
    if (!claim) throw new NotFoundException(`No claim for key "${key}" in scope "${scope}" — it may have been cleaned up`);
    return claim;
  }

  /** A 404 too for a claim still in progress — it has nothing saved yet. */
  async getClaimResponse(key: string, scope: string): Promise<CachedResponse> {
    const response = await this.observability.getClaimResponse(
      textParam('key', key) as string,
      textParam('scope', scope) as string,
    );
    if (!response) {
      throw new NotFoundException(`No saved response for key "${key}" in scope "${scope}" — unknown, cleaned up, or still in progress`);
    }
    return response;
  }

  async listClaims(query: ClaimQueryDto): Promise<ClaimPage> {
    try {
      return await this.observability.listClaims({
        status: statusParam(query.status),
        scope: textParam('scope', query.scope),
        route: textParam('route', query.route),
        correlationId: textParam('correlationId', query.correlationId),
        since: dateParam('since', query.since),
        until: dateParam('until', query.until),
        limit: limitParam(query.limit),
        cursor: query.cursor,
      });
    } catch (err) {
      if (err instanceof InvalidIdempotencyCursorError) {
        throw new BadRequestException('"cursor" is not one this endpoint returned — start again without it');
      }
      throw err;
    }
  }

  getTrace(correlationId: string, query: ClaimQueryDto): Promise<ClaimPage> {
    return this.listClaims({ ...query, correlationId });
  }

  claimHealthSummary(since?: string): Promise<ClaimHealthSummary> {
    return this.observability.claimHealthSummary({ since: dateParam('since', since) });
  }

  claimsByRoute(since?: string): Promise<RouteClaimCount[]> {
    return this.observability.claimsByRoute({ since: dateParam('since', since) });
  }
}
