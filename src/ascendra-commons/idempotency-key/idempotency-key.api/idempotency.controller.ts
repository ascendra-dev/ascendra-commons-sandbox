import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, RequiresAction } from '../../authorization/authorization.core';
import type { ClaimPage } from '../idempotency-key.core';
import { IDEMPOTENCY_ACTIONS } from './idempotency-api.options';
import { IdempotencyApiService } from './idempotency-api.service';

/**
 * api-contract.md Rule 4's cursor-based list shape. The core port's `{ claims, nextCursor }` stays a domain type — the
 * wire shape is this controller's concern. An absent `nextCursor` serializes as `meta: {}`. The health summary and the
 * per-route counts are bounded, so they stay bare (Rule 4's bounded case).
 */
async function toCursorList(page: Promise<ClaimPage>) {
  const { claims, nextCursor } = await page;
  return { data: claims, meta: { nextCursor } };
}

/**
 * Read endpoints for an idempotency support/ops screen: claim lookup (by
 * `key`+`scope`), a filtered list, a cross-module correlation trace, a
 * health summary and per-route counts — gated on `idempotency.view` — and a claim's saved response body, on its own
 * `idempotency.view-response` (it can hold personal data). No tenant scoping — see
 * `IdempotencyApiService`'s doc comment for why. Requires `AuthorizationGuard`
 * wired globally as `APP_GUARD` (see `authorization.core`'s README) — and fails
 * closed without it: `AuthorizationEnforcedGuard` turns a missing global guard
 * into a 500 naming the fix, rather than every signed-in user reading saved
 * responses.
 */
@Controller('idempotency-keys')
@UseGuards(AuthorizationEnforcedGuard)
export class IdempotencyController {
  constructor(@Inject(IdempotencyApiService) private readonly service: IdempotencyApiService) {}

  @Get()
  @RequiresAction(IDEMPOTENCY_ACTIONS.VIEW)
  claims(
    @Query('status') status?: 'pending' | 'completed',
    @Query('scope') scope?: string,
    @Query('route') route?: string,
    @Query('correlationId') correlationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return toCursorList(this.service.listClaims({
      status,
      scope,
      route,
      correlationId,
      since,
      until,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    }));
  }

  @Get('trace/:correlationId')
  @RequiresAction(IDEMPOTENCY_ACTIONS.VIEW)
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

  @Get('health')
  @RequiresAction(IDEMPOTENCY_ACTIONS.VIEW)
  health(@Query('since') since?: string) {
    return this.service.claimHealthSummary(since);
  }

  /** Claims and duplicates per endpoint — bounded by the routes, so a bare array. */
  @Get('routes')
  @RequiresAction(IDEMPOTENCY_ACTIONS.VIEW)
  routes(@Query('since') since?: string) {
    return this.service.claimsByRoute(since);
  }

  @Get(':scope/:key')
  @RequiresAction(IDEMPOTENCY_ACTIONS.VIEW)
  claim(@Param('scope') scope: string, @Param('key') key: string) {
    return this.service.getClaim(key, scope);
  }

  /** The saved response body — its own action, since it can hold personal data. 404 unless the claim is kept and completed. */
  @Get(':scope/:key/response')
  @RequiresAction(IDEMPOTENCY_ACTIONS.VIEW_RESPONSE)
  response(@Param('scope') scope: string, @Param('key') key: string) {
    return this.service.getClaimResponse(key, scope);
  }
}
