import type {
  ConfigScope,
  CoverageGap,
  DeliveryVolume,
  DeliveryContentRecord,
  DeliveryHistoryPage,
  DeliveryHistoryQuery,
  DeliveryRecord,
  DeliveryStats,
  DeliveryStatsQuery,
} from './notification-admin.types';

/**
 * Read-only reporting for a notification admin screen — the delivery log and
 * gaps in the routing/template/credential config. Bound under
 * `NOTIFICATION_OBSERVABILITY_PORT` by a stack adapter; consumed by
 * `notification.api`. Never mutates.
 */
export interface NotificationObservabilityPort {
  /** Delivery attempts, newest first, keyset-paginated. */
  getDeliveryHistory(query?: DeliveryHistoryQuery): Promise<DeliveryHistoryPage>;
  /** One delivery row's metadata (no content) — `null` when the row doesn't exist. */
  getDelivery(id: string): Promise<DeliveryRecord | null>;
  /** The stored rendered content for one row — `null` when the row doesn't exist or `storeContent` was off. */
  getDeliveryContent(id: string): Promise<DeliveryContentRecord | null>;
  /**
   * Holes in the config: a routed channel with no template, or a tenant with no provider account for a channel it is
   * routed to — through its own route or a default one. `tenants` names the tenants to check the default routes for
   * (the app's tenant directory); omitted, every tenant the config names. A `scope` checks that one tenant.
   */
  configCoverageGaps(scope?: ConfigScope, tenants?: readonly string[]): Promise<CoverageGap[]>;
  /** Send volume grouped by channel/status, type/status and day, over one window. Test sends are left out. */
  getDeliveryStats(query?: DeliveryStatsQuery): Promise<DeliveryStats>;
  /** The delivery table's size and age, and per-day rows over the last 30 calendar days in `timeZone`. */
  volume(timeZone?: string, now?: Date): Promise<DeliveryVolume>;
}
