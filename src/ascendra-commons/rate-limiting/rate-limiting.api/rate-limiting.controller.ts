import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, RequiresAction } from '../../authorization/authorization.core';
import { RATE_LIMIT_ACTIONS } from './rate-limiting-api.options';
import { RateLimitingApiService } from './rate-limiting-api.service';

/**
 * Read endpoints for a rate-limiting security/ops screen: the rejection log,
 * a correlation trace, per-route counts and the top identifiers. All gated on
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
    return this.service.listRejections({
      route,
      identifier,
      correlationId,
      since,
      until,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('rejections/trace/:correlationId')
  @RequiresAction(RATE_LIMIT_ACTIONS.VIEW)
  trace(
    @Param('correlationId') correlationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.getTrace(correlationId, {
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get('rejections/catalog')
  @RequiresAction(RATE_LIMIT_ACTIONS.VIEW)
  catalog(@Query('since') since?: string) {
    return this.service.rejectionCatalog(since);
  }

  @Get('rejections/top-identifiers')
  @RequiresAction(RATE_LIMIT_ACTIONS.VIEW)
  topIdentifiers(@Query('since') since?: string, @Query('route') route?: string, @Query('limit') limit?: string) {
    return this.service.topIdentifiers({ since, route, limit: limit !== undefined ? Number(limit) : undefined });
  }
}
