import type { AuditEvent } from './audit-event.interface';

/**
 * Query for `AuditEventReader.summarizeActor` — the Actor Activity screen.
 * Same absent-vs-`null` `tenantId` convention as `AuditQuery`.
 */
export interface ActorActivityQuery {
  tenantId?: string | null;
  occurredAfter?: Date;
  occurredBefore?: Date;
}

export interface ActorActionCount {
  action: string;
  count: number;
  lastOccurredAt: Date;
}

/** What the Actor Activity screen renders (`GET /audit/actors/:actor/activity`). */
export interface ActorActivitySummary {
  actor: string;
  /** `null` when the actor has no matching records. */
  firstSeen: Date | null;
  lastSeen: Date | null;
  totalRecords: number;
  /** `array_agg(DISTINCT tenant_id)` — includes `null` when the actor touched a platform-level record. */
  tenantsTouched: Array<string | null>;
  byAction: ActorActionCount[];
}

export interface AuditDailyCount {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  count: number;
}

export interface AuditActionCount {
  action: string;
  count: number;
}

export interface AuditActorCount {
  actor: string;
  count: number;
}

export interface AuditTenantCount {
  tenantId: string | null;
  count: number;
}

/** What the Overview screen renders (`GET /audit/stats`). */
export interface AuditStats {
  /** Normalized window label, e.g. `'30d'` (see `parseStatsWindow`). */
  window: string;
  /** Oldest first. */
  perDay: AuditDailyCount[];
  topActions: AuditActionCount[];
  topActors: AuditActorCount[];
  perTenant: AuditTenantCount[];
}

/** Body of `POST /audit/coverage` — a vertical's own declared catalog. */
export interface AuditCoverageQuery {
  entityTypes: string[];
  actions: string[];
  tenantId?: string | null;
}

export interface AuditCoverageEntry {
  kind: 'entityType' | 'action';
  value: string;
  /** Rows ever recorded matching this declared entity type / action. */
  count: number;
  assessment: 'healthy' | 'never_audited';
}

/**
 * Filter for reading audit records back — for a compliance/ops admin screen.
 * Every field is optional and ANDed; an omitted field is not constrained.
 * `tenantId` distinguishes absent (no tenant filter) from an explicit `null`
 * (only platform-level events, `tenant_id IS NULL`).
 *
 * `entityType`+`entityId` and `tenantId`+`occurredAfter`/`occurredBefore` are
 * the two indexed access paths (`commons_audit_event_entity_idx`,
 * `commons_audit_event_tenant_time_idx`). `actor`, `action`, `correlationId`
 * have no dedicated index — fine for their expected cardinality (a
 * correlation id is a handful of rows; `actor`/`action` are normally combined
 * with an indexed filter).
 */
export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  tenantId?: string | null;
  actor?: string;
  action?: string;
  correlationId?: string;
  occurredAfter?: Date;
  occurredBefore?: Date;
  /** Default 50, capped at 200. */
  limit?: number;
  /** Opaque — pass the previous page's `nextCursor`. */
  cursor?: string;
}

export interface AuditQueryResult {
  /** Newest first. */
  records: AuditEvent[];
  /** Present only when more records match — pass back as `AuditQuery.cursor`. */
  nextCursor?: string;
}

/**
 * The read port — deliberately separate from `AuditEventRepository` (which
 * stays `insert()`-only), so a consumer with a custom write repository isn't
 * forced to implement reads too, and "audit records are write-once" stays
 * self-evident from the write port's shape. This mirrors `background-jobs`'
 * split between `JobRunRecorder` (write) and `PostgresJobObservabilityService`
 * (read). `find()` never mutates.
 *
 * Never imported by feature code — an admin API module resolves it.
 */
export interface AuditEventReader {
  find(query: AuditQuery): Promise<AuditQueryResult>;

  /**
   * How many records match `query`'s filters, counting no further than `max`
   * (returns `min(actual, max)`) — so it stays cheap on a huge table. `limit`
   * and `cursor` are ignored. The CSV export uses it to know its row count and
   * whether it hit the cap before streaming any rows.
   */
  countUpTo(query: AuditQuery, max: number): Promise<number>;

  /**
   * One record by id — the Record Detail screen's permalink / deep link.
   * `tenantId` follows `AuditQuery`'s convention: absent = no filter (a
   * platform admin may fetch any record), a string = only that tenant's
   * record, `null` = only a platform-level (`tenant_id IS NULL`) record.
   * Returns `null` rather than throwing when nothing matches (including a
   * cross-tenant hit) — the caller (`.api`) turns that into a 404, so a
   * non-platform actor can't distinguish "doesn't exist" from "not yours".
   */
  findOne(id: string, tenantId?: string | null): Promise<AuditEvent | null>;

  /** One actor's activity summary — the Actor Activity screen. */
  summarizeActor(actor: string, query: ActorActivityQuery): Promise<ActorActivitySummary>;

  /**
   * Aggregate volume/shape stats over `window` (e.g. `'30d'`, see
   * `parseStatsWindow`) — the Overview screen. `tenantId` follows the same
   * absent/string/`null` convention as `AuditQuery.tenantId`.
   */
  stats(window: string, tenantId?: string | null): Promise<AuditStats>;

  /**
   * Per-request drift check — for each declared entity type / action, how
   * many rows actually exist. No catalog table: the caller supplies its own
   * declared set every call. The Coverage & Gaps screen.
   */
  countByDeclared(query: AuditCoverageQuery): Promise<AuditCoverageEntry[]>;
}
