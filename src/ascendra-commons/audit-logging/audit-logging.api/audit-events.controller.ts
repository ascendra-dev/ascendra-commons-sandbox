import { Readable } from 'node:stream';
import { Body, Controller, Get, Inject, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { CurrentActor, RequiresAction, type Actor } from '../../authorization/authorization.core';
import type { AuditQueryResult } from '../audit-logging.core';
import { AUDIT_ACTIONS } from './audit-api.options';
import { streamAuditEventsCsv } from './audit-events-csv';
import { AuditEventsApiService } from './audit-events-api.service';
import type { AuditCoverageRequestDto } from './dto/audit-api.dto';

/**
 * api-contract.md Rule 4's cursor-based list shape. The core port's `{ records, nextCursor }`
 * stays a domain type (the postgres reader and the CSV endpoint use it as-is) — the wire
 * shape is this controller's concern. An absent `nextCursor` serializes as `meta: {}`.
 */
function toCursorList({ records, nextCursor }: AuditQueryResult) {
  return { data: records, meta: { nextCursor } };
}

/** The bit of the platform response the CSV export touches — structural, so no express/fastify import. */
interface ExportResponse {
  getHeader(name: string): unknown;
  setHeader(name: string, value: string): unknown;
}

const EXPORT_HEADERS = ['Content-Disposition', 'X-Export-Row-Count', 'X-Export-Truncated', 'X-Export-Limit'];

/**
 * Read endpoints for a compliance / ops audit screen. All gated on `audit.view`.
 * A non-platform actor's reads are auto-scoped to their own tenant (see
 * `AuditEventsApiService`). Requires `AuthorizationGuard` wired globally as
 * `APP_GUARD` (see `authorization.core`'s README).
 */
@Controller('audit')
export class AuditEventsController {
  constructor(@Inject(AuditEventsApiService) private readonly service: AuditEventsApiService) {}

  @Get('events')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  async events(
    @CurrentActor() actor: Actor,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('actor') actorFilter?: string,
    @Query('action') action?: string,
    @Query('correlationId') correlationId?: string,
    @Query('occurredAfter') occurredAfter?: string,
    @Query('occurredBefore') occurredBefore?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return toCursorList(await this.service.find(actor, {
      entityType,
      entityId,
      tenantId,
      actor: actorFilter,
      action,
      correlationId,
      occurredAfter,
      occurredBefore,
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    }));
  }

  /**
   * api-contract Rule 9: every row matching the list's filters (no pagination), up to the
   * configured cap, streamed as CSV. Row count and truncation travel as response headers.
   */
  @Get('events.csv')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  async eventsCsv(
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: ExportResponse,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('actor') actorFilter?: string,
    @Query('action') action?: string,
    @Query('correlationId') correlationId?: string,
    @Query('occurredAfter') occurredAfter?: string,
    @Query('occurredBefore') occurredBefore?: string,
  ): Promise<StreamableFile> {
    const result = await this.service.exportEvents(actor, {
      entityType,
      entityId,
      tenantId,
      actor: actorFilter,
      action,
      correlationId,
      occurredAfter,
      occurredBefore,
    });
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Export-Row-Count', String(result.rowCount));
    res.setHeader('X-Export-Truncated', String(result.truncated));
    res.setHeader('X-Export-Limit', String(result.limit));
    // Append, don't overwrite — an app-level CORS setup may already expose others (e.g. X-Request-Id).
    const exposed = res.getHeader('Access-Control-Expose-Headers');
    res.setHeader('Access-Control-Expose-Headers', [exposed, ...EXPORT_HEADERS].filter(Boolean).join(', '));
    return new StreamableFile(Readable.from(streamAuditEventsCsv(result.pages)), {
      type: 'text/csv; charset=utf-8',
    });
  }

  @Get('events/:id')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  event(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.service.findOne(actor, id);
  }

  @Get('actors/:actor/activity')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  actorActivity(
    @CurrentActor() actor: Actor,
    @Param('actor') actorFilter: string,
    @Query('occurredAfter') occurredAfter?: string,
    @Query('occurredBefore') occurredBefore?: string,
  ) {
    return this.service.actorActivity(actor, actorFilter, { occurredAfter, occurredBefore });
  }

  @Get('stats')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  stats(@CurrentActor() actor: Actor, @Query('window') window?: string, @Query('tenantId') tenantId?: string) {
    return this.service.stats(actor, { window, tenantId });
  }

  /** api-contract.md Rule 4's bounded bare-array case — the app's fixed vocabulary, never paginated. */
  @Get('catalog')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  catalog() {
    return this.service.catalog();
  }

  @Post('coverage')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  coverage(@CurrentActor() actor: Actor, @Body() body?: AuditCoverageRequestDto) {
    return this.service.coverage(actor, body);
  }

  @Get('entities/:type/:id/history')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  async entityHistory(
    @CurrentActor() actor: Actor,
    @Param('type') type: string,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return toCursorList(await this.service.entityHistory(actor, type, id, {
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    }));
  }

  @Get('trace/:correlationId')
  @RequiresAction(AUDIT_ACTIONS.VIEW)
  async trace(
    @CurrentActor() actor: Actor,
    @Param('correlationId') correlationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return toCursorList(await this.service.trace(actor, correlationId, {
      limit: limit !== undefined ? Number(limit) : undefined,
      cursor,
    }));
  }
}
