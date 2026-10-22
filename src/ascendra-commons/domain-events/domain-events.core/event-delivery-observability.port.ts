import type { EventDeliveryAttempt } from './event-delivery-recorder.port';

/** One `commons_domain_events_delivery` row, mapped and typed — what a delivery-log UI table renders. */
export interface EventDeliveryRecord {
  /** The `bigserial` id as a string (Postgres returns bigint as text to avoid precision loss). */
  id: string;
  eventName: string;
  method: EventDeliveryAttempt['method'];
  transport: string;
  /** The business fact's own time (`event.occurredAt`) — what every read filters, sorts and counts by. */
  occurredAt: Date;
  /** When the transport recorded the hand-off. The same moment as `occurredAt` in-process, unless the event was backdated. */
  deliveredAt: Date;
  listenerCount: number;
  status: EventDeliveryAttempt['status'];
  reason: string | null;
  correlationId: string | null;
}

export interface DeliveryQuery {
  eventName?: string;
  method?: EventDeliveryAttempt['method'];
  status?: EventDeliveryAttempt['status'];
  /** Join a delivery to the same id in audit / notification-delivery / job-run for a cross-module trace. */
  correlationId?: string;
  /** Inclusive lower bound on `occurredAt`. */
  since?: Date;
  /** Exclusive upper bound on `occurredAt`. */
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. Anything else throws `InvalidDeliveryCursorError`. */
  cursor?: string;
  /**
   * Sort direction on `(occurredAt, id)`. Default `'desc'` (newest first) — the delivery log. A trace requests `'asc'`,
   * so a request / job timeline reads top to bottom.
   */
  order?: 'asc' | 'desc';
}

export interface DeliveryPage {
  /** Ordered per `DeliveryQuery.order` — newest first by default. */
  deliveries: EventDeliveryRecord[];
  /** Present only when more rows match — pass back as `DeliveryQuery.cursor`. */
  nextCursor?: string;
}

/** A period: deliveries whose event occurred since `since` — everything retained when omitted. */
export interface DeliveryPeriodQuery {
  since?: Date;
}

/** The Overview's numbers over a period. */
export interface DeliverySummary {
  total: number;
  delivered: number;
  /** Fired with nobody subscribed — a wiring gap, not a listener failure. */
  noListeners: number;
  /** The transport itself failed before reaching any listener — rare. */
  dispatchFailed: number;
  /** Raised with `emitCritical()` — the producer waited on its listeners. */
  critical: number;
  /** Distinct event names that fired. */
  eventNames: number;
}

/** One event name's deliveries over a period — the catalog, and the Wiring screen's "what fired" half. */
export interface EventDeliveryCatalogEntry {
  eventName: string;
  total: number;
  /** Raised with `emit()` — fire-and-forget. With a `@OnCriticalEvent()` listener, its failure is silently swallowed. */
  emitCount: number;
  /** Raised with `emitCritical()`. */
  emitCriticalCount: number;
  noListenerCount: number;
  dispatchFailedCount: number;
  /** The most recent occurrence in the period. */
  lastOccurredAt: Date;
  /** How many listeners were subscribed at that most recent delivery. */
  lastListenerCount: number;
}

/** Deliveries per calendar day, and what the table holds — the Volume & Retention screen. */
export interface DeliveryVolume {
  /** The oldest stored delivery's `occurredAt` — how far back the log goes (what a prune last left). `null` when empty. */
  oldestOccurredAt: Date | null;
  /** Stored deliveries (rows) for this application. */
  rowCount: number;
  /** The whole table's on-disk size, every application sharing it included. `null` when the store can't say. */
  tableSizeBytes: number | null;
  /** The past 30 calendar days in the requested time zone, oldest first, zero-filled. */
  perDay: Array<{ day: string; count: number; noListenerCount: number; dispatchFailedCount: number }>;
}

/**
 * Read-only reporting over the delivery log for an admin screen. Bound under
 * `EVENT_DELIVERY_OBSERVABILITY_PORT` by a stack adapter; consumed by
 * `domain-events.api`. Never mutates — deliveries are write-once, like
 * `audit-logging`'s records. Every read is on `occurredAt`.
 */
export interface EventDeliveryObservabilityPort {
  /** Delivery attempts, keyset-paginated, ordered per `DeliveryQuery.order` (default newest first). */
  listDeliveries(query?: DeliveryQuery): Promise<DeliveryPage>;
  /** The Overview's totals over a period. */
  deliverySummary(query?: DeliveryPeriodQuery): Promise<DeliverySummary>;
  /** One row per event name that fired in the period, most deliveries first. */
  deliveryCatalog(query?: DeliveryPeriodQuery): Promise<EventDeliveryCatalogEntry[]>;
  /** Per-day counts for the past 30 calendar days in `timeZone` (default UTC), plus the table's extent. */
  volume(timeZone?: string, now?: Date): Promise<DeliveryVolume>;
}
