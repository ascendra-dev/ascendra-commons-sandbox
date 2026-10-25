import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_RECIPIENT_HASHER,
  USER_CONTACT_RESOLVER,
  type NotificationRecipientHasher,
  type UserContactResolver,
} from '../../notification.core';
import { recipientNames } from '../shared/recipient-names';
import {
  InvalidDeliveryCursorError,
  isValidTimeZone,
  NOTIFICATION_OBSERVABILITY_PORT,
  type DeliveryRecord,
  type NotificationObservabilityPort,
} from '../../notification.core.database';
import { correlationIdParam, dateParam, enumParam, flagParam, idParam, textParam } from '../shared/params';
import { NOTIFICATION_API_OPTIONS, NOTIFICATION_AUDIT_EMITTER, NOTIFICATION_TENANT_DIRECTORY } from '../tokens';
import type { NotificationTenantDirectory } from '../notification-tenant-directory.port';
import type { NotificationAuditEmitter } from '../notification-audit.port';
import type { NotificationApiOptions } from '../notification-api.options';
import type { DeliveryHistoryQueryDto, DeliveryStatsQueryDto } from '../dto/notification-api.dto';

/** A delivery row, with its user recipient's name when the app's resolver knows it. */
export type DeliveryView = DeliveryRecord & { recipientName: string | null };

const DEFAULT_WINDOW = '7d';
const WINDOW_RE = /^(\d+)(h|d)$/;
/** A window longer than this is a typo, not a question — and an unbounded GROUP BY. */
const MAX_WINDOW_DAYS = 366;

const STATUSES = ['sent', 'failed', 'delivered', 'bounced', 'skipped'] as const;

/**
 * Thin orchestration over `NotificationObservabilityPort` — the reads are
 * already UI-shaped, so this is mostly passthrough plus parsing date-string
 * query params and turning a missing content row into a 404.
 *
 * **Tenant ceiling** — `getDeliveryHistory`, `getDelivery` and
 * `getDeliveryStats` all force `tenantId = actor.tenantId` for a non-platform
 * actor, ignoring whatever tenant the caller asked for; a platform admin's
 * request passes through unscoped. Without this, `query.tenantId` would be
 * forwarded to the port verbatim and any actor could read any tenant's
 * deliveries.
 */
@Injectable()
export class NotificationObservabilityApiService {
  constructor(
    @Inject(NOTIFICATION_OBSERVABILITY_PORT) private readonly port: NotificationObservabilityPort,
    @Inject(NOTIFICATION_API_OPTIONS) private readonly options: NotificationApiOptions,
    @Inject(NOTIFICATION_AUDIT_EMITTER) private readonly audit: NotificationAuditEmitter,
    @Optional() @Inject(NOTIFICATION_TENANT_DIRECTORY) private readonly tenants?: NotificationTenantDirectory,
    @Optional() @Inject(NOTIFICATION_RECIPIENT_HASHER) private readonly hasher: NotificationRecipientHasher | null = null,
    @Optional() @Inject(USER_CONTACT_RESOLVER) private readonly users: UserContactResolver | null = null,
  ) {}

  /** Each delivery with its user recipient's name (the app's resolver) — `null` for a guest or an unknown user. */
  private async named(deliveries: DeliveryRecord[]): Promise<DeliveryView[]> {
    const names = await recipientNames(this.users, deliveries.map((d) => d.recipientRef));
    return deliveries.map((d) => ({ ...d, recipientName: names.get(d.recipientRef) ?? null }));
  }

  /**
   * `recipientKey` as given, or `recipientAddress` hashed the way Notifier keys it — an email (it has an @) or a phone
   * number. The address never reaches the database.
   */
  private recipientKeyFilter(key?: string, address?: string): string | undefined {
    const given = idParam('recipientKey', key, true);
    const raw = textParam('recipientAddress', address, 320);
    if (!raw) return given;
    if (given) throw new BadRequestException('give "recipientKey" or "recipientAddress", not both');
    if (!this.hasher) {
      throw new BadRequestException('searching by address needs recipient hashing — NotificationModule.forRoot({ recipientHashKey })');
    }
    return raw.includes('@') ? this.hasher.hashEmail(raw) : this.hasher.hashPhone(raw);
  }

  async getDeliveryHistory(actor: Actor, query: DeliveryHistoryQueryDto): Promise<{ deliveries: DeliveryView[]; nextCursor?: string }> {
    const tenantId = await this.resolveTenantFilter(actor, idParam('tenantId', query.tenantId, true));
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) {
      throw new BadRequestException('"limit" must be a positive whole number');
    }
    try {
      const page = await this.port.getDeliveryHistory({
        notificationType: idParam('notificationType', query.notificationType, true),
        channel: enumParam('channel', query.channel, NOTIFICATION_CHANNELS),
        tenantId,
        recipientRef: idParam('recipientRef', query.recipientRef, true),
        recipientKey: this.recipientKeyFilter(query.recipientKey, query.recipientAddress),
        status: enumParam('status', query.status, STATUSES),
        correlationId: correlationIdParam('correlationId', query.correlationId),
        reason: reasonCodeParam(query.reason),
        test: query.test === undefined || query.test === '' ? undefined : flagParam('test', query.test),
        since: dateParam('since', query.since),
        until: dateParam('until', query.until),
        limit: query.limit,
        cursor: query.cursor || undefined,
      });
      return { deliveries: await this.named(page.deliveries), nextCursor: page.nextCursor };
    } catch (err) {
      if (err instanceof InvalidDeliveryCursorError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /** 404s (rather than 403) when the row exists but belongs to another tenant — doesn't leak existence. */
  async getDelivery(actor: Actor, id: string) {
    const record = await this.port.getDelivery(id);
    if (!record) throw new NotFoundException('no such delivery');
    if (!(await this.options.isPlatformAdmin(actor)) && record.tenantId !== actor.tenantId) {
      throw new NotFoundException('no such delivery');
    }
    return (await this.named([record]))[0];
  }

  /**
   * The rendered message — scoped like the row itself: another tenant's delivery is the same 404 as a missing one.
   * (The content is the most sensitive thing here: names, amounts, addresses in the variables.)
   */
  async getDeliveryContent(actor: Actor, id: string) {
    const delivery = await this.getDelivery(actor, id);
    const record = await this.port.getDeliveryContent(id);
    if (!record) throw new NotFoundException('no stored content for that delivery');
    // Who read which message — filed under the delivery's tenant, so that tenant's own audit log shows it.
    await this.audit.record({
      action: 'notification.content_viewed',
      actorId: actor.id,
      tenantId: delivery.tenantId,
      entityType: 'delivery',
      entityId: id,
    });
    return record;
  }

  /**
   * Scoped like the config reads — a tenant admin sees gaps in the defaults and their own tenant only. A platform
   * admin's checks the default routes for every tenant the app's directory names (when bound).
   */
  async coverageGaps(actor: Actor) {
    if (!(await this.options.isPlatformAdmin(actor))) return this.port.configCoverageGaps({ tenantId: actor.tenantId ?? '' });
    return this.port.configCoverageGaps(undefined, await this.tenants?.listTenantIds());
  }

  async getDeliveryStats(actor: Actor, query: DeliveryStatsQueryDto) {
    const tenantId = await this.resolveTenantFilter(actor, idParam('tenantId', query.tenantId, true));
    const timeZone = timeZoneParam(query.tz);
    const window = resolveWindow(query.window);
    // '7d' is seven whole calendar days in the viewer's zone; '24h' a rolling window.
    return 'days' in window
      ? this.port.getDeliveryStats({ tenantId, days: window.days, timeZone })
      : this.port.getDeliveryStats({ tenantId, since: window.since, until: window.until, timeZone });
  }

  /** The table's size and age — the whole app's, every tenant's rows: a platform admin's. */
  async volume(actor: Actor, tz?: string) {
    if (!(await this.options.isPlatformAdmin(actor))) {
      throw new ForbiddenException("the delivery log's volume and retention are the platform's — every tenant's rows");
    }
    return this.port.volume(timeZoneParam(tz));
  }

  /** Non-platform actor → forced to their own tenant, regardless of what was requested. */
  private async resolveTenantFilter(actor: Actor, requested?: string): Promise<string | undefined> {
    if (await this.options.isPlatformAdmin(actor)) return requested;
    return actor.tenantId ?? undefined;
  }
}

/** `'24h'` — a rolling window; `'7d'`, `'30d'` — whole calendar days. Anything else is a 400, not a silent 7 days. */
function resolveWindow(window?: string): { days: number } | { since: Date; until: Date } {
  const match = WINDOW_RE.exec(window || DEFAULT_WINDOW);
  const amount = match ? Number(match[1]) : NaN;
  const hours = match?.[2] === 'h' ? amount : amount * 24;
  if (!match || amount < 1 || hours > MAX_WINDOW_DAYS * 24) {
    throw new BadRequestException(`"window" must look like '24h' or '7d' (up to ${MAX_WINDOW_DAYS} days)`);
  }
  if (match[2] === 'd') return { days: amount };
  const until = new Date();
  return { since: new Date(until.getTime() - hours * 60 * 60 * 1000), until };
}

/** An IANA zone (`Asia/Dubai`, `UTC`) — the days are counted in it. Default UTC. */
function timeZoneParam(tz?: string): string {
  if (tz === undefined || tz === '') return 'UTC';
  if (tz.length > 64 || !isValidTimeZone(tz)) throw new BadRequestException('"tz" must be an IANA time zone, e.g. Asia/Dubai');
  return tz;
}

/** A reason's code, as the stats name it — lowercase words joined by underscores. */
function reasonCodeParam(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
    throw new BadRequestException('"reason" must be a reason code, like template_not_found');
  }
  return value;
}
