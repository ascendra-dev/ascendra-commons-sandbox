import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';
import {
  AUDIT_EVENT_READER,
  diffFields,
  InvalidAuditCursorError,
  isValidTimeZone,
  type ActorActivitySummary,
  type AuditCoverageEntry,
  type AuditEvent,
  type AuditEventDetail,
  type AuditEventReader,
  type AuditQuery,
  type AuditOverviewStats,
  type AuditQueryResult,
  type AuditRetentionStats,
  type AuditTopActionsStats,
} from '../audit-logging.core';
import { AUDIT_API_OPTIONS } from './tokens';
import type { AuditApiOptions, AuditCatalog } from './audit-api.options';
import type {
  AuditActorActivityQueryDto,
  AuditCoverageRequestDto,
  AuditEventsExportQueryDto,
  AuditEventsQueryDto,
  AuditRetentionQueryDto,
  AuditStatsQueryDto,
} from './dto/audit-api.dto';

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

/** Rows fetched per `find()` call while an export walks its result — the postgres reader's own max page size. */
const EXPORT_PAGE_SIZE = 200;

/** What `GET /audit/events.csv` sends: api-contract Rule 9's headers, plus the rows to stream. */
export interface AuditEventsExport {
  filename: string;
  /** Rows the export will stream — `min(matched, limit)`. */
  rowCount: number;
  /** More rows matched than `limit` allowed. */
  truncated: boolean;
  limit: number;
  /** Newest first, walked lazily page by page as the response streams. */
  pages: AsyncIterable<AuditEvent[]>;
}

/**
 * Reads audit records for a compliance/ops screen, over `AuditEventReader`. The
 * one actor-scoped rule: a non-platform actor's query is **forced** to their own
 * `tenantId` — they can only see their own tenant's activity feed; a platform
 * admin sees everything (and may filter by any `tenantId`, or `null` for
 * platform-level rows). Date-string params are parsed here.
 */
@Injectable()
export class AuditEventsApiService {
  constructor(
    @Inject(AUDIT_EVENT_READER) private readonly reader: AuditEventReader,
    @Inject(AUDIT_API_OPTIONS) private readonly options: AuditApiOptions,
  ) {}

  async find(actor: Actor, dto: AuditEventsQueryDto): Promise<AuditQueryResult> {
    return this.query(actor, this.baseQuery(dto));
  }

  /**
   * The full filtered result of `find()`, for the CSV export — not one page, up to
   * `exportMaxRows`. Pins `occurredBefore` to now so rows written mid-export can't
   * disagree with the up-front `rowCount`, then counts (capped) before any row is
   * read, so the response headers are known before the body streams.
   */
  async exportEvents(actor: Actor, dto: AuditEventsExportQueryDto): Promise<AuditEventsExport> {
    const now = new Date();
    const base = this.baseQuery(dto);
    const query = await this.scoped(actor, {
      ...base,
      occurredBefore: base.occurredBefore && base.occurredBefore < now ? base.occurredBefore : now,
    });
    const limit = this.options.exportMaxRows;
    const matched = await this.reader.countUpTo(query, limit + 1);
    const rowCount = Math.min(matched, limit);
    return {
      filename: `audit-events-${now.toISOString().slice(0, 19).replace(/:/g, '-')}Z.csv`,
      rowCount,
      truncated: matched > limit,
      limit,
      pages: this.walk(query, rowCount),
    };
  }

  async entityHistory(actor: Actor, entityType: string, entityId: string, dto: AuditEventsQueryDto): Promise<AuditQueryResult> {
    return this.query(actor, { ...this.baseQuery(dto), entityType, entityId });
  }

  async trace(actor: Actor, correlationId: string, dto: AuditEventsQueryDto): Promise<AuditQueryResult> {
    return this.query(actor, { ...this.baseQuery(dto), correlationId });
  }

  /**
   * One record, plus its field-level diff — the Record Detail screen. Same
   * tenant-scoping rule as `find()`: a non-platform actor can only fetch a
   * record in their own tenant. A cross-tenant id (or an id that doesn't
   * exist at all) 404s either way, so existence is never leaked.
   */
  async findOne(actor: Actor, id: string): Promise<AuditEventDetail> {
    const tenantId = await this.resolveTenantScope(actor);
    const event = await this.reader.findOne(id, tenantId);
    if (!event) throw new NotFoundException(`audit record '${id}' not found`);
    return { ...event, diff: diffFields(event.before, event.after) };
  }

  /** The Actor Activity screen. Same tenant-scoping rule as `find()`. */
  async actorActivity(actor: Actor, actorFilter: string, dto: AuditActorActivityQueryDto): Promise<ActorActivitySummary> {
    const tenantId = await this.resolveTenantScope(actor);
    return this.reader.summarizeActor(actorFilter, {
      ...(tenantId !== undefined ? { tenantId } : {}),
      occurredAfter: dateParam('occurredAfter', dto.occurredAfter),
      occurredBefore: dateParam('occurredBefore', dto.occurredBefore),
    });
  }

  /** The Overview screen's KPI row and volume chart (window defaults to 30 days, days bucketed in `tz`, default UTC). */
  async overviewStats(actor: Actor, dto: AuditStatsQueryDto): Promise<AuditOverviewStats> {
    if (dto.tz !== undefined && !isValidTimeZone(dto.tz)) throw new BadRequestException(`Unknown time zone "${dto.tz}"`);
    return this.reader.overviewStats(dto.window ?? '30d', await this.statsTenant(actor, dto), dto.tz ?? 'UTC');
  }

  /** The Overview screen's Top actions, by (entity type, action) (window defaults to 7 days). */
  async topActions(actor: Actor, dto: AuditStatsQueryDto): Promise<AuditTopActionsStats> {
    return this.reader.topActions(dto.window ?? '7d', await this.statsTenant(actor, dto));
  }

  /** The Retention & Volume screen — scoped like the Overview (a tenant admin sees their own tenant's, with no table size). */
  async retention(actor: Actor, dto: AuditRetentionQueryDto): Promise<AuditRetentionStats> {
    return this.reader.retention(await this.statsTenant(actor, dto));
  }

  /**
   * The filter selects' options: the configured audit vocabulary (`forRoot({ catalog })`) and the applications the
   * reader is scoped to. Configuration, not tenant data — so not tenant-scoped.
   */
  catalog(): AuditCatalog {
    return { entries: this.options.catalog, applications: this.reader.applications() };
  }

  /**
   * The Coverage & Gaps screen — a per-request comparison, no catalog table. An empty body falls
   * back to the configured catalog, so the screen and the filter selects share one list.
   */
  async coverage(actor: Actor, dto: AuditCoverageRequestDto | undefined): Promise<AuditCoverageEntry[]> {
    const tenantId = await this.resolveTenantScope(actor);
    const declaresNothing = !dto?.entityTypes?.length && !dto?.actions?.length;
    return this.reader.countByDeclared({
      entityTypes: declaresNothing ? this.options.catalog.map((e) => e.entityType) : (dto?.entityTypes ?? []),
      actions: declaresNothing ? this.options.catalog.flatMap((e) => e.actions) : (dto?.actions ?? []),
      ...(tenantId !== undefined ? { tenantId } : {}),
    });
  }

  /**
   * Whose figures the Overview shows. A non-platform actor's are forced to their own tenant; a platform admin sees
   * every tenant by default and may filter to one via `tenantId` (or `'null'` for platform-level rows only) — same
   * convention as `find()`'s `tenantId` param.
   */
  private async statsTenant(actor: Actor, dto: { tenantId?: string }): Promise<string | null | undefined> {
    if (await this.options.isPlatformAdmin(actor)) {
      return dto.tenantId !== undefined ? (dto.tenantId === 'null' ? null : dto.tenantId) : undefined;
    }
    if (actor.tenantId === null) {
      throw new ForbiddenException('a tenant-scoped actor cannot read the audit log without a tenant');
    }
    return actor.tenantId;
  }

  /** `undefined` → platform admin, unrestricted. Throws for a tenant-scoped actor with no tenant. */
  private async resolveTenantScope(actor: Actor): Promise<string | undefined> {
    if (await this.options.isPlatformAdmin(actor)) return undefined;
    if (actor.tenantId === null) {
      throw new ForbiddenException('a tenant-scoped actor cannot read the audit log without a tenant');
    }
    return actor.tenantId;
  }

  private async query(actor: Actor, query: AuditQuery): Promise<AuditQueryResult> {
    const scoped = await this.scoped(actor, query);
    try {
      return await this.reader.find(scoped);
    } catch (err) {
      if (err instanceof InvalidAuditCursorError) {
        throw new BadRequestException('"cursor" is not one this endpoint returned — start again without it');
      }
      throw err;
    }
  }

  /** `query` as `actor` may run it — a non-platform actor is forced to their own tenant. */
  private async scoped(actor: Actor, query: AuditQuery): Promise<AuditQuery> {
    if (await this.options.isPlatformAdmin(actor)) return query;
    if (actor.tenantId === null) {
      throw new ForbiddenException('a tenant-scoped actor cannot read the audit log without a tenant');
    }
    return { ...query, tenantId: actor.tenantId };
  }

  /** Follows `nextCursor` until `total` rows are yielded or the result runs out. */
  private async *walk(query: AuditQuery, total: number): AsyncGenerator<AuditEvent[]> {
    let remaining = total;
    let cursor: string | undefined;
    while (remaining > 0) {
      const page = await this.reader.find({ ...query, limit: Math.min(EXPORT_PAGE_SIZE, remaining), cursor });
      const records = page.records.slice(0, remaining);
      yield records;
      remaining -= records.length;
      if (!page.nextCursor) return;
      cursor = page.nextCursor;
    }
  }

  private baseQuery(dto: AuditEventsQueryDto): AuditQuery {
    if (dto.limit !== undefined && (!Number.isInteger(dto.limit) || dto.limit < 1)) {
      throw new BadRequestException('"limit" must be a positive whole number');
    }
    const query: AuditQuery = {
      application: dto.application,
      entityType: dto.entityType,
      entityId: dto.entityId,
      actor: dto.actor,
      action: dto.action,
      correlationId: dto.correlationId,
      occurredAfter: dateParam('occurredAfter', dto.occurredAfter),
      occurredBefore: dateParam('occurredBefore', dto.occurredBefore),
      limit: dto.limit,
      cursor: dto.cursor,
    };
    // Only a platform admin ever reaches a tenantId filter (query() overwrites it otherwise).
    if (dto.tenantId !== undefined) query.tenantId = dto.tenantId === 'null' ? null : dto.tenantId;
    return query;
  }
}
