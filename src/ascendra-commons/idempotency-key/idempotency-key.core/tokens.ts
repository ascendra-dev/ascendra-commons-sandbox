/**
 * Injection tokens. Symbols, not string literals — a typo in a binding is a
 * compile error, not a silently unbound provider.
 */

/** What `IdempotencyInterceptor` depends on — bound to whichever `IdempotencyStore` implementation the app wires. */
export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

/** Bound to `ActorScopeResolver` by default, or to the consumer's own resolver (for an anonymously-reachable endpoint). */
export const IDEMPOTENCY_SCOPE_RESOLVER = Symbol('IDEMPOTENCY_SCOPE_RESOLVER');

/**
 * What an admin/observability caller injects — bound to an
 * `IdempotencyObservabilityPort` implementation. A stack adapter's
 * observability module binds it; `idempotency-key.api` consumes it. Never
 * touched by feature code.
 */
export const IDEMPOTENCY_OBSERVABILITY_PORT = Symbol('IDEMPOTENCY_OBSERVABILITY_PORT');
