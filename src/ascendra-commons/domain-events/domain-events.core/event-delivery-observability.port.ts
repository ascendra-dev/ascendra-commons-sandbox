import type { EventDeliveryAttempt } from './event-delivery-recorder.port';

/** One `commons_domain_events_delivery` row, mapped and typed — what a delivery-log UI table renders. */
export interface EventDeliveryRecord {
  /** The `bigserial` id as a string (Postgres returns bigint as text to avoid precision loss). */
  id: string;
  eventName: string;
  method: EventDeliveryAttempt['method'];
  transport: string;
  occurredAt: Date;
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
  /** Inclusive lower bound on `deliveredAt`. */
  since?: Date;
  /** Exclusive upper bound on `deliveredAt`. */
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. */
  cursor?: string;
  /**
   * Sort direction on `(deliveredAt, id)`. Default `'desc'` (newest first) —
   * the base delivery-list screen. The trace endpoint (`getTrace()`) requests
   * `'asc'` so a request/job timeline reads top-to-bottom chronologically
   * without an undocumented client-side reversal.
   */
  order?: 'asc' | 'desc';
}

export interface DeliveryPage {
  /** Ordered per `DeliveryQuery.order` — newest first by default. */
  deliveries: EventDeliveryRecord[];
  /** Present only when more rows match — pass back as `DeliveryQuery.cursor`. */
  nextCursor?: string;
}

/** One row of the "what events actually fire" dashboard — aggregated from the delivery log, not the (separate) listener catalogue. */
export interface EventDeliveryCatalogEntry {
  eventName: string;
  totalDeliveries: number;
  /** Times this event fired with zero listeners subscribed — a wiring gap, not a listener failure. */
  noListenerCount: number;
  /** Times the transport itself failed to dispatch — rare; see `EventDeliveryAttempt.status`. */
  dispatchFailedCount: number;
  lastDeliveredAt: Date;
}

/** One day's worth of deliveries, for the Overview dashboard's bar chart. */
export interface DeliveryStatsDay {
  /** `YYYY-MM-DD`, the UTC calendar day `date_trunc('day', deliveredAt)` falls on. */
  date: string;
  total: number;
  noListenerCount: number;
  dispatchFailedCount: number;
}

/** One row of the Overview dashboard's "top events in this window" table. */
export interface DeliveryStatsTopEvent {
  eventName: string;
  totalDeliveries: number;
}

/** The Overview dashboard's aggregate over a trailing time window. */
export interface DeliveryStats {
  /** Ascending by date, oldest first — chart-ready. */
  perDay: DeliveryStatsDay[];
  /** Busiest events in the window, highest `totalDeliveries` first. */
  topEvents: DeliveryStatsTopEvent[];
  /** Fraction (0–1) of the window's deliveries with `status === 'no_listeners'`. `0` when the window has no deliveries. */
  noListenerRate: number;
  /** Fraction (0–1) of the window's deliveries with `status === 'dispatch_failed'`. `0` when the window has no deliveries. */
  dispatchFailedRate: number;
}

/**
 * Read-only reporting over the delivery log for an admin screen. Bound under
 * `EVENT_DELIVERY_OBSERVABILITY_PORT` by a stack adapter; consumed by
 * `domain-events.api`. Never mutates — deliveries are write-once, like
 * `audit-logging`'s records.
 */
export interface EventDeliveryObservabilityPort {
  /** Delivery attempts, keyset-paginated, ordered per `DeliveryQuery.order` (default newest first). */
  listDeliveries(query?: DeliveryQuery): Promise<DeliveryPage>;
  /** One row per event name that has ever fired — "what events exist and how have they behaved." */
  deliveryCatalog(): Promise<EventDeliveryCatalogEntry[]>;
  /** The Overview dashboard's aggregate — deliveries since the given lower bound on `deliveredAt`. */
  deliveryStats(since: Date): Promise<DeliveryStats>;
}
