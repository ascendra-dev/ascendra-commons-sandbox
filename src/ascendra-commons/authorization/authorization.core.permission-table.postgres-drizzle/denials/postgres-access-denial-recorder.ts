import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AccessDenial, AccessDenialRecorder } from '../../authorization.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { DENIAL_APPLICATION_ID, DENIAL_RECORDER_OPTIONS, DENIAL_SQL_EXECUTOR } from '../tokens';

export const DENIAL_WINDOW_MS = 60_000;
/** Where denials past `maxBufferedKeys` in one interval are counted — per action and route, so totals stay exact. */
export const OVERFLOW_ACTOR = '(overflow)';

export interface PostgresAccessDenialRecorderOptions {
  /** How often the buffer is written. Default 10 s. */
  flushIntervalMs?: number;
  /** Distinct windows held between writes. Default 10,000 — past it, new actors count under `(overflow)`. */
  maxBufferedKeys?: number;
  /** The app's ambient correlation id (audit-logging's `getCurrentCorrelationId`) for a denial sent without one. */
  correlationIdResolver?: () => string | undefined;
}

const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const DEFAULT_MAX_BUFFERED_KEYS = 10_000;
const ROWS_PER_INSERT = 1_000;
const MAX_TEXT = 256;
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

interface BufferedWindow {
  actorId: string;
  tenantId: string | null;
  action: string;
  method: string;
  route: string;
  windowStart: Date;
  correlationId: string | null;
  count: number;
  firstDeniedAt: Date;
  lastDeniedAt: Date;
}

/** Storable text: no NUL (Postgres `text` rejects it), bounded. */
function text(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.replaceAll('\u0000', '') : '';
  if (s.length === 0) return fallback;
  return s.length <= MAX_TEXT ? s : s.slice(0, MAX_TEXT);
}

/**
 * `AccessDenialRecorder` for Postgres — counts 403s in memory and upserts them every `flushIntervalMs`, one row per
 * (actor, tenant, action, method, route, minute) — the correlation id is the window's latest, a sample to trace, never
 * part of the key: every request carries its own, so keyed on it a burst would write a row per request. A denied request — possibly an attacker's, at their
 * rate — never waits on the database. Each denial is normalized as it's buffered, so one malformed value can't sink a
 * batch. The buffer is bounded; it's written on shutdown (`app.enableShutdownHooks()`). A failed write is logged with
 * how many denials it lost, never retried; the 403s themselves are unaffected.
 */
@Injectable()
export class PostgresAccessDenialRecorder implements AccessDenialRecorder, OnModuleDestroy {
  private readonly logger = new Logger(PostgresAccessDenialRecorder.name);
  private readonly maxBufferedKeys: number;
  private readonly resolveCorrelationId?: () => string | undefined;
  private readonly timer: NodeJS.Timeout;
  private buffer = new Map<string, BufferedWindow>();
  private flushing = false;

  constructor(
    @Inject(DENIAL_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(DENIAL_APPLICATION_ID) private readonly application: string,
    @Optional() @Inject(DENIAL_RECORDER_OPTIONS) options: PostgresAccessDenialRecorderOptions = {},
  ) {
    this.maxBufferedKeys = Math.max(1, options.maxBufferedKeys ?? DEFAULT_MAX_BUFFERED_KEYS);
    this.resolveCorrelationId = options.correlationIdResolver;
    // Started here so a hand-constructed recorder flushes too; unref'd so it never holds the process open.
    this.timer = setInterval(() => void this.flush(), Math.max(100, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS));
    this.timer.unref();
  }

  recordDenial(denial: AccessDenial): void {
    const at = denial.at instanceof Date && !Number.isNaN(denial.at.getTime()) ? denial.at : new Date();
    const windowStart = new Date(Math.floor(at.getTime() / DENIAL_WINDOW_MS) * DENIAL_WINDOW_MS);
    const item: BufferedWindow = {
      actorId: text(denial.actorId, '(unknown)'),
      tenantId: denial.tenantId == null ? null : text(denial.tenantId, '(unknown)'),
      action: text(denial.action, '(unknown)'),
      method: text(denial.method, 'GET').toUpperCase(),
      route: text(denial.route, '(unknown)'),
      windowStart,
      correlationId: this.correlationId(denial.correlationId),
      count: 1,
      firstDeniedAt: at,
      lastDeniedAt: at,
    };
    let key = windowKey(item);
    if (!this.buffer.has(key) && this.buffer.size >= this.maxBufferedKeys) {
      item.actorId = OVERFLOW_ACTOR;
      item.tenantId = null;
      item.correlationId = null;
      key = windowKey(item);
    }
    const existing = this.buffer.get(key);
    if (existing) {
      existing.count += 1;
      if (at < existing.firstDeniedAt) existing.firstDeniedAt = at;
      if (at >= existing.lastDeniedAt) {
        existing.lastDeniedAt = at;
        // The latest request's id is the window's sample — never part of its key (every request has its own).
        existing.correlationId = item.correlationId ?? existing.correlationId;
      }
      return;
    }
    this.buffer.set(key, item);
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.size === 0) return;
    this.flushing = true;
    const windows = [...this.buffer.values()];
    this.buffer = new Map();
    try {
      for (let i = 0; i < windows.length; i += ROWS_PER_INSERT) {
        await this.upsert(windows.slice(i, i + ROWS_PER_INSERT));
      }
    } catch (err) {
      const lost = windows.reduce((sum, w) => sum + w.count, 0);
      this.logger.error(`Failed to record ${lost} access denial(s) — the 403s themselves are unaffected`, err instanceof Error ? err.stack : String(err));
    } finally {
      this.flushing = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }

  private correlationId(given: string | undefined): string | null {
    if (given && CORRELATION_ID.test(given)) return given;
    try {
      const ambient = this.resolveCorrelationId?.();
      return ambient && CORRELATION_ID.test(ambient) ? ambient : null;
    } catch {
      return null;
    }
  }

  private async upsert(windows: BufferedWindow[]): Promise<void> {
    const values = windows.map(
      (w) => sql`(
        ${this.application}, ${w.actorId}, ${w.tenantId}, ${w.action}, ${w.method}, ${w.route}, ${w.windowStart},
        ${w.count}, ${w.firstDeniedAt}, ${w.lastDeniedAt}, ${w.correlationId}
      )`,
    );
    await this.db.execute(sql`
      insert into commons_authz_denial as d
        (application, actor_id, tenant_id, action, method, route, window_start, denial_count, first_denied_at, last_denied_at, correlation_id)
      values ${sql.join(values, sql`, `)}
      on conflict on constraint commons_authz_denial_window_uq do update set
        denial_count = d.denial_count + excluded.denial_count,
        first_denied_at = least(d.first_denied_at, excluded.first_denied_at),
        last_denied_at = greatest(d.last_denied_at, excluded.last_denied_at),
        correlation_id = case when excluded.last_denied_at >= d.last_denied_at
          then coalesce(excluded.correlation_id, d.correlation_id) else d.correlation_id end
    `);
  }
}

function windowKey(w: BufferedWindow): string {
  return JSON.stringify([w.actorId, w.tenantId, w.action, w.method, w.route, w.windowStart.getTime()]);
}
