/**
 * Request shapes for `audit-logging.api`. Plain interfaces — `ascendra-commons`
 * carries no validation library. The controller reads query strings; the `.api`
 * service parses dates and applies the actor-scoped tenant filter.
 */
export interface AuditEventsQueryDto {
  entityType?: string;
  entityId?: string;
  /** Only honored for a platform admin; a non-platform actor is pinned to their own tenant. `'null'` = platform-level rows. */
  tenantId?: string;
  actor?: string;
  action?: string;
  correlationId?: string;
  occurredAfter?: string;
  occurredBefore?: string;
  limit?: number;
  cursor?: string;
}

/** Query params for `GET /audit/events.csv` — the list's filters, without pagination (api-contract Rule 9). */
export type AuditEventsExportQueryDto = Omit<AuditEventsQueryDto, 'limit' | 'cursor'>;

/** Query params for `GET /audit/actors/:actor/activity`. */
export interface AuditActorActivityQueryDto {
  occurredAfter?: string;
  occurredBefore?: string;
}

/** Query params for `GET /audit/stats/overview` and `/audit/stats/top-actions`. */
export interface AuditStatsQueryDto {
  /** e.g. `'30d'` — see `parseStatsWindow`. Defaults to 30 days (overview) / 7 days (top actions). */
  window?: string;
  /** Only honored for a platform admin, same convention as `AuditEventsQueryDto.tenantId`. */
  tenantId?: string;
}

/** Query params for `GET /audit/retention`. */
export interface AuditRetentionQueryDto {
  /** Only honored for a platform admin, same convention as `AuditEventsQueryDto.tenantId`. */
  tenantId?: string;
}

/**
 * Body of `POST /audit/coverage` — the caller's own declared catalog. Leave both empty (or send
 * no body) to use the catalog configured on `AuditApiModule.forRoot`.
 */
export interface AuditCoverageRequestDto {
  entityTypes?: string[];
  actions?: string[];
}
