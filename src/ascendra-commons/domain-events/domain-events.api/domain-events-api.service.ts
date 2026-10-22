import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  EVENT_DELIVERY_OBSERVABILITY_PORT,
  EVENT_LISTENER_CATALOG_PORT,
  InvalidDeliveryCursorError,
  isValidTimeZone,
  type DeliveryPage,
  type DeliverySummary,
  type DeliveryVolume,
  type EventDeliveryCatalogEntry,
  type EventDeliveryObservabilityPort,
  type EventListenerCatalogEntry,
  type EventListenerCatalogPort,
} from '../domain-events.core';
import type { DeliveryQueryDto } from './dto/domain-events-api.dto';

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

/** One of `allowed`, or a 400 — an unknown value would match nothing and read as "none". */
function enumParam<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value !== undefined && !(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException(`"${name}" must be one of ${allowed.join(', ')}`);
  }
  return value as T | undefined;
}

const METHODS = ['emit', 'emitCritical'] as const;
const STATUSES = ['delivered', 'no_listeners', 'dispatch_failed'] as const;
const ORDERS = ['asc', 'desc'] as const;

/**
 * Thin orchestration over `EventDeliveryObservabilityPort` (the runtime delivery log) and `EventListenerCatalogPort`
 * (the static wiring map). No tenant scoping — a delivery row has no tenant (an event's tenant is a payload fact, and
 * the payload isn't stored). Params are validated here — a bad date, limit, enum, time zone or cursor, or a NUL byte
 * in any text, is a 400, never a 500. No mutation surface — deliveries are write-once and the listener catalogue is a
 * live read of the running app.
 */
@Injectable()
export class DomainEventsApiService {
  constructor(
    @Inject(EVENT_DELIVERY_OBSERVABILITY_PORT) private readonly deliveries: EventDeliveryObservabilityPort,
    @Inject(EVENT_LISTENER_CATALOG_PORT) private readonly listenerCatalog: EventListenerCatalogPort,
  ) {}

  async listDeliveries(query: DeliveryQueryDto): Promise<DeliveryPage> {
    try {
      return await this.deliveries.listDeliveries({
        eventName: textParam('eventName', query.eventName),
        method: enumParam('method', query.method, METHODS),
        status: enumParam('status', query.status, STATUSES),
        correlationId: textParam('correlationId', query.correlationId),
        since: dateParam('since', query.since),
        until: dateParam('until', query.until),
        limit: limitParam(query.limit),
        cursor: query.cursor,
        order: enumParam('order', query.order, ORDERS),
      });
    } catch (err) {
      if (err instanceof InvalidDeliveryCursorError) {
        throw new BadRequestException('"cursor" is not one this endpoint returned — start again without it');
      }
      throw err;
    }
  }

  /** A request / job timeline reads top to bottom — always ascending, whatever the caller's `order`. */
  getTrace(correlationId: string, query: DeliveryQueryDto): Promise<DeliveryPage> {
    return this.listDeliveries({ ...query, correlationId, order: 'asc' });
  }

  deliverySummary(since?: string): Promise<DeliverySummary> {
    return this.deliveries.deliverySummary({ since: dateParam('since', since) });
  }

  deliveryCatalog(since?: string): Promise<EventDeliveryCatalogEntry[]> {
    return this.deliveries.deliveryCatalog({ since: dateParam('since', since) });
  }

  volume(tz?: string): Promise<DeliveryVolume> {
    if (tz !== undefined && !isValidTimeZone(tz)) throw new BadRequestException(`Unknown time zone "${tz}"`);
    return this.deliveries.volume(tz);
  }

  listListenerBindings(): Promise<EventListenerCatalogEntry[]> {
    return this.listenerCatalog.list();
  }
}
