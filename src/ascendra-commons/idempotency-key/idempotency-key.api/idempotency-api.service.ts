import { BadRequestException, Inject, Injectable } from '@nestjs/common';
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
 * Thin orchestration over `IdempotencyObservabilityPort`. No tenant scoping —
 * `scope` is opaque to this module (whatever the app's own
 * `IdempotencyScopeResolver` returns), so there is no safe generic way to
 * auto-restrict a caller to "their own" scope the way `audit-logging.api` does
 * for `tenantId`. Gate `idempotency.view` to an ops/support persona instead —
 * see the module README. Params are validated here — a bad date, limit or
 * cursor is a 400, never a 500. No mutation surface — claims are written only
 * by `IdempotencyStore`.
 */
@Injectable()
export class IdempotencyApiService {
  constructor(@Inject(IDEMPOTENCY_OBSERVABILITY_PORT) private readonly observability: IdempotencyObservabilityPort) {}

  getClaim(key: string, scope: string): Promise<IdempotencyClaimRecord | null> {
    return this.observability.getClaim(key, scope);
  }

  getClaimResponse(key: string, scope: string): Promise<CachedResponse | null> {
    return this.observability.getClaimResponse(key, scope);
  }

  async listClaims(query: ClaimQueryDto): Promise<ClaimPage> {
    try {
      return await this.observability.listClaims({
        status: query.status,
        scope: query.scope,
        route: query.route,
        correlationId: query.correlationId,
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
