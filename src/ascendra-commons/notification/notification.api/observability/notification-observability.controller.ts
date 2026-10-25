import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { NOTIFICATION_ACTIONS } from '../notification-api.options';
import { NotificationObservabilityApiService } from './notification-observability-api.service';
import { cursorList, positiveIntParam } from '../shared/params';

/**
 * Read endpoints for a "did it send / is the config complete" admin screen. All
 * gated on `notification.view`. Requires `AuthorizationGuard` wired globally as
 * `APP_GUARD` (see `authorization.core`'s README).
 *
 * `deliveries`, `deliveries/:id` and `stats` are tenant-ceiling-scoped in the
 * service — a non-platform actor only ever sees their own tenant's rows.
 */
@Controller('notifications')
@UseGuards(AuthorizationEnforcedGuard)
export class NotificationObservabilityController {
  constructor(
    @Inject(NotificationObservabilityApiService) private readonly service: NotificationObservabilityApiService,
  ) {}

  @Get('deliveries')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  async deliveries(
    @CurrentActor() actor: Actor,
    @Query('notificationType') notificationType?: string,
    @Query('channel') channel?: string,
    @Query('tenantId') tenantId?: string,
    @Query('recipientRef') recipientRef?: string,
    @Query('recipientKey') recipientKey?: string,
    @Query('recipientAddress') recipientAddress?: string,
    @Query('status') status?: string,
    @Query('correlationId') correlationId?: string,
    @Query('reason') reason?: string,
    @Query('test') test?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    // api-contract.md Rule 4 — the port's { deliveries, nextCursor } stays a domain type; the wire shape is this one.
    const page = await this.service.getDeliveryHistory(actor, {
      notificationType,
      channel,
      tenantId,
      recipientRef,
      recipientKey,
      recipientAddress,
      status,
      correlationId,
      reason,
      test,
      since,
      until,
      limit: positiveIntParam('limit', limit),
      cursor,
    });
    return cursorList(page.deliveries, page.nextCursor);
  }

  @Get('deliveries/:id')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  delivery(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.getDelivery(actor, id);
  }

  /** The stored rendered message — its own action, `notification.view_content`, and every read is audited. */
  @Get('deliveries/:id/content')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW_CONTENT)
  deliveryContent(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.getDeliveryContent(actor, id);
  }

  @Get('config/coverage-gaps')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  coverageGaps(@CurrentActor() actor: Actor) {
    return this.service.coverageGaps(actor);
  }

  @Get('stats')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  stats(
    @CurrentActor() actor: Actor,
    @Query('tenantId') tenantId?: string,
    @Query('window') window?: string,
    @Query('tz') tz?: string,
  ) {
    return this.service.getDeliveryStats(actor, { tenantId, window, tz });
  }

  /** Volume & retention — per-day rows over 30 days in `?tz=`, the table's size and age. Platform admins only. */
  @Get('volume')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  volume(@CurrentActor() actor: Actor, @Query('tz') tz?: string) {
    return this.service.volume(actor, tz);
  }
}
