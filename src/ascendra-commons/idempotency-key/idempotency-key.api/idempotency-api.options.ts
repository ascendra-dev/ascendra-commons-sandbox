import type { DynamicModule } from '@nestjs/common';

/**
 * The `@RequiresAction` gate name `idempotency-key.api`'s endpoints declare.
 * Fixed — `@RequiresAction` is applied at class-definition time. Restrict this
 * to an ops / support persona — a claim's `scope` is whatever the app's
 * `IdempotencyScopeResolver` returns (usually a tenant/actor id), but this API
 * does not itself enforce a caller-vs-scope match (see the module README).
 */
export const IDEMPOTENCY_ACTIONS = {
  /** Read claims, the health summary and the per-route counts — never a saved response body. */
  VIEW: 'idempotency.view',
  /**
   * Read a claim's saved response body — what a retry is replayed. It can hold personal data (a payment's payer, an
   * invoice's customer), so it's a separate grant from VIEW: give it to the few who answer "what did they get back?".
   */
  VIEW_RESPONSE: 'idempotency.view-response',
} as const;

export interface IdempotencyApiModuleConfig {
  /** Modules exporting `IDEMPOTENCY_OBSERVABILITY_PORT` (a stack adapter's `PostgresIdempotencyObservabilityModule`). */
  imports?: DynamicModule['imports'];
}
