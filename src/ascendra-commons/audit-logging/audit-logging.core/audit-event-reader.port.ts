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

/** One (entity type, action) pair — a verb-only `created` means different things for an invoice and a user. */
export interface ActorActionCount {
  entityType: string;
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

/** A KPI's value now, and its change against the equal period just before. */
export interface AuditKpiValue {
  value: number;
  /** Percent change vs. the prior period, one decimal; `null` when the prior period was empty (no meaningful %). */
  deltaPct: number | null;
}

/** Fixed rolling periods, independent of the overview's `window` (see `kpiValue`). */
export interface AuditStatsKpis {
  /** Records in the past 24 hours, vs. the 24 hours before. */
  records24h: AuditKpiValue;
  /** Records in the past 7 days, vs. the 7 days before. */
  records7d: AuditKpiValue;
  /** Distinct actors in the past 30 days, vs. the 30 days before. */
  distinctActors30d: AuditKpiValue;
  /** Distinct entity types in the past 30 days, vs. the 30 days before. */
  entityTypes30d: AuditKpiValue;
}

/** `GET /audit/stats/overview` — the Overview screen's KPI row and volume chart. */
export interface AuditOverviewStats {
  /** Normalized window label, e.g. `'30d'` (see `parseStatsWindow`). */
  window: string;
  /** Every UTC day in the window, oldest first — `0` on a day with no records (see `fillDailyCounts`). */
  perDay: AuditDailyCount[];
  kpis: AuditStatsKpis;
}

/** One row of the Top actions ranking — by (entity type, action), so `created` for invoices and users stay apart. */
export interface AuditTopAction {
  entityType: string;
  action: string;
  count: number;
  /** Distinct actors behind those records. */
  actors: number;
}

/** `GET /audit/stats/top-actions` — the Overview screen's Top actions table. */
export interface AuditTopActionsStats {
  window: string;
  /** The 10 most frequent, most frequent first. */
  topActions: AuditTopAction[];
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
   * The Overview screen's KPI row and daily volume over `window` (e.g. `'30d'`,
   * see `parseStatsWindow`). `tenantId` follows the same absent/string/`null`
   * convention as `AuditQuery.tenantId`.
   */
  overviewStats(window: string, tenantId?: string | null): Promise<AuditOverviewStats>;

  /** The Overview screen's Top actions over `window`, ranked by (entity type, action). Same `tenantId` convention. */
  topActions(window: string, tenantId?: string | null): Promise<AuditTopActionsStats>;

  /**
   * Per-request drift check — for each declared entity type / action, how
   * many rows actually exist. No catalog table: the caller supplies its own
   * declared set every call. The Coverage & Gaps screen.
   */
  countByDeclared(query: AuditCoverageQuery): Promise<AuditCoverageEntry[]>;
}
