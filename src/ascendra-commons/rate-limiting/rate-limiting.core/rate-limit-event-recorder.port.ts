/** One rejected request, as the guard observed it. */
export interface RateLimitRejection {
  /** The route pattern the limit was declared on (e.g. `/pay/:token`) — the path pattern, never the resolved URL with real ids in it. */
  route: string;
  /** Whatever the throttler resolved as the requester's identity for this limit — an IP, most commonly. */
  identifier: string;
  /** The configured limit that was exceeded. */
  limit: number;
  /** The configured rolling window, in milliseconds. */
  ttlMs: number;
  /** The caller-supplied correlation id, when present on the request, for a cross-module trace. */
  correlationId?: string;
}

/**
 * The rejection-log port. A throttler-integration guard (see
 * `rate-limiting.core.throttler`) calls `recordRejection()` once per `429`.
 * **Best-effort by contract: an implementation must not throw** — a failure
 * to log a rejection must never change whether the request is actually
 * throttled.
 *
 * It runs on the `429` path, under exactly the load it exists to report, so
 * an implementation shouldn't do I/O per call — `PostgresRateLimitEventRecorder`
 * counts in memory and writes on an interval.
 *
 * Bound under `RATE_LIMIT_EVENT_RECORDER`; `NoopRateLimitEventRecorder` (this
 * package) is the default when nothing is configured.
 */
export interface RateLimitEventRecorder {
  recordRejection(rejection: RateLimitRejection): Promise<void>;
}
