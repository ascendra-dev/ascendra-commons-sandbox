import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, RequiresAction } from '../../authorization/authorization.core';
import type { RejectionPage } from '../rate-limiting.core';
import { RATE_LIMIT_ACTIONS } from './rate-limiting-api.options';
import { RateLimitingApiService } from './rate-limiting-api.service';

/**
 * api-contract.md Rule 4's cursor-based list shape. The core port's `{ rejections, nextCursor }`
 * stays a domain type — the wire shape is this controller's concern. An absent `nextCursor`
 * serializes as `meta: {}`. The catalog and top identifiers are bounded (by routes, by `limit`),
 * so they stay bare arrays (Rule 4's bounded case).
 */
async function toCursorList(page: Promise<RejectionPage>) {
  const { rejections, nextCursor } = await page;
  return { data: rejections, meta: { nextCursor } };
}

/**
 * Read endpoints for a rate-limiting security/ops screen: the rejection log,
 * a correlation trace, per-route counts, the top identifiers and the volume card. All gated on
 * `rate-limit.view`. No tenant scoping. Requires `AuthorizationGuard` wired
 * globally as `APP_GUARD` (see `authorization.core`'s README) — and fails closed
 * without it: `AuthorizationEnforcedGuard` turns a missing global guard into a
 * 500 naming the fix, rather than every signed-in user reading the log.
 */
@Controller('rate-limits')
@UseGuards(AuthorizationEnforcedGuard)
export class RateLimitingController {
  constructor(@Inject(RateLimitingApiService) private readonly service: RateLimitingApiService) {}

  @Get('rejections')
  @RequiresAction(RATE_LIMIT_ACTIONS.VIEW)
  rejections(
    @Query('route') route?: string,
    @Query('identifier') identifier?: string,
    @Query('correlationId') correlationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return toCursorList(this.service.listRejections({
      route,
      identifier,
      correlationId,
      since,
      until,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    }));
  }

  @Get('rejections/trace/:correlationId')
  @RequiresAction(RATE_LIMIT_ACTIONS.VIEW)
  trace(
    @Param('correlationId') correlationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return toCursorList(this.service.getTrace(correlationId, {
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    }));
  }

  @Get('rejections/catalog')
  @RequiresAction(RATE_LIMIT_ACTIONS.VIEW)
  catalog(@Query('since') since?: string) {
    return this.service.rejectionCatalog(since);
  }

  @Get('rejections/volume')
  @RequiresAction(RATE_LIMIT_ACTIONS.VIEW)
  volume(@Query('tz') tz?: string) {
    return this.service.volume(tz);
  }

  @Get('rejections/top-identifiers')
  @RequiresAction(RATE_LIMIT_ACTIONS.VIEW)
  topIdentifiers(@Query('since') since?: string, @Query('route') route?: string, @Query('limit') limit?: string) {
    return this.service.topIdentifiers({ since, route, limit: limit !== undefined ? Number(limit) : undefined });
  }
}
