/**
 * Injection tokens. Symbols, not string literals — a typo in a binding is a
 * compile error, not a silently unbound provider.
 */

/** What a throttler-integration guard injects to log rejections. Optional — falls back to `NoopRateLimitEventRecorder`. */
export const RATE_LIMIT_EVENT_RECORDER = Symbol('RATE_LIMIT_EVENT_RECORDER');

/** What an admin/observability caller injects — bound to a `RateLimitObservabilityPort` implementation. */
export const RATE_LIMIT_OBSERVABILITY_PORT = Symbol('RATE_LIMIT_OBSERVABILITY_PORT');
