import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  InvalidRateLimitCursorError,
  isValidTimeZone,
  RATE_LIMIT_OBSERVABILITY_PORT,
  type IdentifierRejectionCount,
  type RateLimitObservabilityPort,
  type RejectionPage,
  type RejectionVolume,
  type RouteRejectionCount,
} from '../rate-limiting.core';
import type { RejectionQueryDto, TopIdentifiersQueryDto } from './dto/rate-limiting-api.dto';

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

/**
 * Thin orchestration over `RateLimitObservabilityPort`. No tenant scoping —
 * a rejected, unauthenticated request has no tenant to scope by; gate
 * `rate-limit.view` to an ops/security persona instead. Params are
 * validated here — a bad date, limit or cursor, or a NUL byte in any text, is a 400, never a 500. No mutation surface — rejections are write-once, recorded
 * only by `RecordingThrottlerGuard`.
 */
@Injectable()
export class RateLimitingApiService {
  constructor(@Inject(RATE_LIMIT_OBSERVABILITY_PORT) private readonly observability: RateLimitObservabilityPort) {}

  async listRejections(query: RejectionQueryDto): Promise<RejectionPage> {
    try {
      return await this.observability.listRejections({
        route: textParam('route', query.route),
        identifier: textParam('identifier', query.identifier),
        correlationId: textParam('correlationId', query.correlationId),
        since: dateParam('since', query.since),
        until: dateParam('until', query.until),
        limit: limitParam(query.limit),
        cursor: query.cursor,
      });
    } catch (err) {
      if (err instanceof InvalidRateLimitCursorError) {
        throw new BadRequestException('"cursor" is not one this endpoint returned — start again without it');
      }
      throw err;
    }
  }

  getTrace(correlationId: string, query: RejectionQueryDto): Promise<RejectionPage> {
    return this.listRejections({ ...query, correlationId });
  }

  rejectionCatalog(since?: string): Promise<RouteRejectionCount[]> {
    return this.observability.rejectionCatalog(dateParam('since', since));
  }

  volume(tz?: string): Promise<RejectionVolume> {
    if (tz !== undefined && !isValidTimeZone(tz)) throw new BadRequestException(`Unknown time zone "${tz}"`);
    return this.observability.volume(tz);
  }

  topIdentifiers(query: TopIdentifiersQueryDto): Promise<IdentifierRejectionCount[]> {
    return this.observability.topIdentifiers({
      since: dateParam('since', query.since),
      route: textParam('route', query.route),
      limit: limitParam(query.limit),
    });
  }
}
