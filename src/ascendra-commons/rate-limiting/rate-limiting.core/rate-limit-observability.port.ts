/**
 * One `commons_rate_limit_rejection` row, mapped and typed — every rejection of
 * one route, identifier, limit and correlation id within one minute, counted.
 */
export interface RateLimitRejectionRecord {
  id: string;
  route: string;
  identifier: string;
  limit: number;
  ttlMs: number;
  /** The minute the rejections fell in. Never changes once the row exists — the list's sort key. */
  windowStart: Date;
  /** Rejections in this window. Still growing while the window is current. */
  count: number;
  firstRejectedAt: Date;
  lastRejectedAt: Date;
  correlationId: string | null;
}

export interface RejectionQuery {
  route?: string;
  identifier?: string;
  correlationId?: string;
  /** Inclusive lower bound on `windowStart` — minute-granular. */
  since?: Date;
  /** Exclusive upper bound on `windowStart` — minute-granular. */
  until?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. Anything else throws `InvalidRateLimitCursorError`. */
  cursor?: string;
}

export interface RejectionPage {
  /** Newest window first. */
  rejections: RateLimitRejectionRecord[];
  /** Present only when more rows match — pass back as `RejectionQuery.cursor`. */
  nextCursor?: string;
}

/** One row of the "who's hitting our limits" dashboard. */
export interface RouteRejectionCount {
  route: string;
  /** Total rejections — the windows' counts summed, not the number of windows. */
  count: number;
}

/** One row of the "who is hitting our limits" panel — one identifier's rejections across routes. */
export interface IdentifierRejectionCount {
  /** An IP, most commonly — or `(overflow)`: sources beyond the recorder's buffer, counted together. */
  identifier: string;
  /** Total rejections — the windows' counts summed. */
  count: number;
  /** Every route it was rejected on, alphabetical. */
  routes: string[];
  lastRejectedAt: Date;
}

export interface TopIdentifiersQuery {
  /** Inclusive lower bound on `windowStart`. */
  since?: Date;
  /** Only rejections on this route. */
  route?: string;
  /** Default 10, capped at 100. */
  limit?: number;
}

/**
 * Read-only reporting over the rejection log for a security/ops screen.
 * Bound under `RATE_LIMIT_OBSERVABILITY_PORT` by a stack adapter; consumed by
 * `rate-limiting.api`. Never mutates.
 */
export interface RateLimitObservabilityPort {
  /** Rejection windows, newest first, keyset-paginated. */
  listRejections(query?: RejectionQuery): Promise<RejectionPage>;
  /** Counts per route within an optional window — a spike on one route (e.g. `pay/:token`) is the "being hammered" signal. */
  rejectionCatalog(since?: Date): Promise<RouteRejectionCount[]>;
  /** The identifiers with the most rejections, most first — one source hitting many routes, or one route from many sources. */
  topIdentifiers(query?: TopIdentifiersQuery): Promise<IdentifierRejectionCount[]>;
}
