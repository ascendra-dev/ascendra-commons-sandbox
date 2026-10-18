import type { DynamicModule } from '@nestjs/common';
import type { Actor } from '../../authorization/authorization.core';

/**
 * The `@RequiresAction` gate name `audit-logging.api`'s endpoints declare. Fixed
 * — `@RequiresAction` is applied at class-definition time. Restrict `audit.view`
 * to a compliance / platform-admin persona (and, if you want a per-tenant
 * activity feed, tenant-admin personas — those calls are auto-scoped to the
 * actor's own tenant, see below).
 */
export const AUDIT_ACTIONS = {
  VIEW: 'audit.view',
} as const;

/**
 * One entity type the app audits, with the actions it records against it. Actions are grouped
 * explicitly rather than derived from a name prefix — the naming convention isn't enforced
 * (e.g. `notification.route_set` is recorded on entity type `channel_route`).
 */
export interface AuditCatalogEntry {
  entityType: string;
  actions: string[];
}

/** `GET /audit/catalog` — what the audit UI's filter selects offer. */
export interface AuditCatalog {
  /** The configured vocabulary (`forRoot({ catalog })`) — the Entity type / Action selects. */
  entries: AuditCatalogEntry[];
  /** The applications the reader is scoped to (`AuditEventReader.applications()`) — the Application select. */
  applications: string[];
}

export interface AuditApiModuleConfig {
  /** Modules exporting `AUDIT_EVENT_READER` — a stack adapter's `PostgresAuditObservabilityModule`. */
  imports?: DynamicModule['imports'];
  /**
   * Is this actor a platform admin (may read **every** tenant's audit records,
   * and platform-level `tenant_id IS NULL` rows)? Default: `actor.tenantId === null`.
   * A non-platform actor's reads are forced to their own `tenantId`.
   */
  isPlatformAdmin?: (actor: Actor) => boolean | Promise<boolean>;
  /**
   * The app's own audit vocabulary — served by `GET /audit/catalog` (it feeds the audit UI's
   * Entity type / Action selects) and used by `POST /audit/coverage` when its body declares
   * nothing. Required, so forgetting it is a compile error rather than empty filters at runtime.
   * Declared in code; an app that keeps it in a JSON file can import that file and pass it here.
   */
  catalog: AuditCatalogEntry[];
  /**
   * Row cap for `GET /audit/events.csv`. A larger result is truncated to this many rows (newest
   * first) and flagged via `X-Export-Truncated` (api-contract Rule 9). Default 100,000.
   */
  exportMaxRows?: number;
}

/** The shape bound under `AUDIT_API_OPTIONS`. */
export interface AuditApiOptions {
  isPlatformAdmin: (actor: Actor) => boolean | Promise<boolean>;
  catalog: AuditCatalogEntry[];
  exportMaxRows: number;
}

export function resolveAuditApiOptions(config: AuditApiModuleConfig): AuditApiOptions {
  return {
    isPlatformAdmin: config.isPlatformAdmin ?? ((actor) => actor.tenantId === null),
    catalog: config.catalog,
    exportMaxRows: config.exportMaxRows ?? 100_000,
  };
}
