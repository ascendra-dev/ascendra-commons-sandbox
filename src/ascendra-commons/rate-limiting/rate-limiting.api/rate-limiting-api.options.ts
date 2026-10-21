import type { DynamicModule } from '@nestjs/common';

/**
 * The `@RequiresAction` gate name `rate-limiting.api`'s endpoints declare.
 * Fixed — `@RequiresAction` is applied at class-definition time. Restrict
 * this to an ops/security persona — a rejection is not tenant-scoped
 * (unauthenticated requests have no tenant).
 */
export const RATE_LIMIT_ACTIONS = {
  /** Read the rejection log, per-route counts and top identifiers. */
  VIEW: 'rate-limit.view',
} as const;

export interface RateLimitingApiModuleConfig {
  /** Modules exporting `RATE_LIMIT_OBSERVABILITY_PORT` (a stack adapter's `PostgresRateLimitObservabilityModule`). */
  imports?: DynamicModule['imports'];
}
