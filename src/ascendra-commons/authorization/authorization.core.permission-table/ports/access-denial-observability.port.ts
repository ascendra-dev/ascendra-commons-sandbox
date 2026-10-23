/**
 * The denied-requests log's reads — every 403 `AuthorizationGuard` answered, counted per actor, action, method and
 * route in one-minute windows. Bound under `ACCESS_DENIAL_OBSERVABILITY_PORT` by a stack adapter; `authorization.api` serves it.
 */
export interface AccessDenialView {
  id: string;
  actorId: string;
  tenantId: string | null;
  action: string;
  method: string;
  route: string;
  /** The minute the denials fell in. */
  windowStart: Date;
  count: number;
  firstDeniedAt: Date;
  lastDeniedAt: Date;
  /** The latest denied request's correlation id in the window — a sample to trace. */
  correlationId: string | null;
}

export interface AccessDenialQuery {
  actorId?: string;
  /** Only denials of actors in this tenant; omitted = every tenant (and tenant-less actors). */
  tenantId?: string;
  action?: string;
  correlationId?: string;
  since?: Date;
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  cursor?: string;
}

export interface AccessDenialPage {
  denials: AccessDenialView[];
  nextCursor?: string;
}

export interface AccessDenialSummary {
  /** Denied requests (summed counts). */
  total: number;
  /** Distinct actors denied. */
  actors: number;
  /** The most-denied actions, most first (≤ 10). */
  topActions: Array<{ action: string; count: number; actors: number }>;
  /** The most-denied actors, most first (≤ 10). */
  topActors: Array<{ actorId: string; tenantId: string | null; count: number; actions: number }>;
}

export interface AccessDenialObservabilityPort {
  listDenials(query?: AccessDenialQuery): Promise<AccessDenialPage>;
  /** Over `since` (everything retained when omitted), in `tenantId` when given. */
  denialSummary(query?: { tenantId?: string; since?: Date }): Promise<AccessDenialSummary>;
}
