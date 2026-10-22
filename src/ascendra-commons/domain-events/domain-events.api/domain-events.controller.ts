import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, RequiresAction } from '../../authorization/authorization.core';
import type { DeliveryPage } from '../domain-events.core';
import { DOMAIN_EVENTS_ACTIONS } from './domain-events-api.options';
import { DomainEventsApiService } from './domain-events-api.service';

/**
 * api-contract.md Rule 4's cursor-based list shape. The core port's `{ deliveries, nextCursor }` stays a domain type —
 * the wire shape is this controller's concern. An absent `nextCursor` serializes as `meta: {}`. The summary, catalog,
 * volume and listener catalogue are bounded, so they stay bare (Rule 4's bounded case).
 */
async function toCursorList(page: Promise<DeliveryPage>) {
  const { deliveries, nextCursor } = await page;
  return { data: deliveries, meta: { nextCursor } };
}

/**
 * Read endpoints for an event-delivery admin screen: the delivery log, a correlation-id trace (always chronological),
 * the summary and per-event catalog over a period, the volume, and the static listener-wiring catalogue. All gated on
 * `domain-events.view`. No tenant scoping. Requires `AuthorizationGuard` wired globally as `APP_GUARD` (see
 * `authorization.core`'s README) — and fails closed without it: `AuthorizationEnforcedGuard` turns a missing global
 * guard into a 500 naming the fix, rather than every signed-in user reading the log.
 */
@Controller('domain-events')
@UseGuards(AuthorizationEnforcedGuard)
export class DomainEventsController {
  constructor(@Inject(DomainEventsApiService) private readonly service: DomainEventsApiService) {}

  @Get('deliveries')
  @RequiresAction(DOMAIN_EVENTS_ACTIONS.VIEW)
  deliveries(
    @Query('eventName') eventName?: string,
    @Query('method') method?: string,
    @Query('status') status?: string,
    @Query('correlationId') correlationId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('order') order?: string,
  ) {
    return toCursorList(
      this.service.listDeliveries({
        eventName,
        method,
        status,
        correlationId,
        since,
        until,
        limit: limit !== undefined ? Number(limit) : undefined,
        cursor,
        order,
      }),
    );
  }

  @Get('deliveries/trace/:correlationId')
  @RequiresAction(DOMAIN_EVENTS_ACTIONS.VIEW)
  trace(@Param('correlationId') correlationId: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return toCursorList(
      this.service.getTrace(correlationId, { limit: limit !== undefined ? Number(limit) : undefined, cursor }),
    );
  }

  /** The Overview's totals since `since` (everything retained when omitted). */
  @Get('deliveries/summary')
  @RequiresAction(DOMAIN_EVENTS_ACTIONS.VIEW)
  summary(@Query('since') since?: string) {
    return this.service.deliverySummary(since);
  }

  /** One row per event name that fired since `since`, most deliveries first — bounded by the event names. */
  @Get('deliveries/catalog')
  @RequiresAction(DOMAIN_EVENTS_ACTIONS.VIEW)
  deliveryCatalog(@Query('since') since?: string) {
    return this.service.deliveryCatalog(since);
  }

  /** Per-day counts for 30 calendar days in `tz` (IANA, default UTC), and the table's extent. */
  @Get('deliveries/volume')
  @RequiresAction(DOMAIN_EVENTS_ACTIONS.VIEW)
  volume(@Query('tz') tz?: string) {
    return this.service.volume(tz);
  }

  @Get('listener-catalog')
  @RequiresAction(DOMAIN_EVENTS_ACTIONS.VIEW)
  listenerCatalog() {
    return this.service.listListenerBindings();
  }
}
