import { bigserial, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_rate_limit_rejection` table — one row per rejection
 * *window*: every `429` for one route, identifier, limit and correlation id
 * within one minute, counted. Written by `PostgresRateLimitEventRecorder`,
 * which buffers in memory and upserts on an interval, so a flood costs one row
 * per source per minute, not one write per blocked request. The security/ops
 * analog of `commons_domain_events_delivery`: "is this endpoint being
 * hammered" for an abuse-detection screen.
 */
export const rateLimitRejectionTable = pgTable(
  'commons_rate_limit_rejection',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    application: text('application').notNull(),
    /** The route *pattern* (e.g. `/pay/:token`), never the resolved URL with real ids in it. */
    route: text('route').notNull(),
    /** Whatever the throttler resolved as the requester's identity — an IP, most commonly. `(overflow)` when the recorder's buffer was full. */
    identifier: text('identifier').notNull(),
    limit: integer('limit').notNull(),
    ttlMs: integer('ttl_ms').notNull(),
    /** The minute these rejections fell in — part of the row's key, never updated. */
    windowStart: timestamp('window_start', { withTimezone: true, mode: 'date' }).notNull(),
    rejectionCount: integer('rejection_count').notNull(),
    firstRejectedAt: timestamp('first_rejected_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastRejectedAt: timestamp('last_rejected_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Nullable — the caller's correlation id, when present on the request, for a cross-module trace. */
    correlationId: text('correlation_id'),
  },
  (t) => [
    /** The recorder's `ON CONFLICT` target — NULL correlation ids merge too. */
    unique('commons_rate_limit_rejection_window_key')
      .on(t.application, t.route, t.identifier, t.limit, t.ttlMs, t.windowStart, t.correlationId)
      .nullsNotDistinct(),
    /** "recent rejections" — the default admin-screen query. */
    index('commons_rate_limit_rejection_time_idx').on(t.application, t.windowStart),
    /** `rejectionCatalog()`'s own per-route aggregate — "is this specific endpoint being hammered." */
    index('commons_rate_limit_rejection_route_idx').on(t.application, t.route, t.windowStart),
    /** "who's hitting our limits" — a lookup by identifier across routes. */
    index('commons_rate_limit_rejection_identifier_idx').on(t.identifier, t.windowStart),
  ],
);
