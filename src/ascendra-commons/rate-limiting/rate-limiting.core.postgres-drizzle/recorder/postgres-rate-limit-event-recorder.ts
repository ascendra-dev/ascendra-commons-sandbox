import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { RateLimitEventRecorder, RateLimitRejection } from '../../rate-limiting.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { RATE_LIMIT_APPLICATION_ID, RATE_LIMIT_RECORDER_OPTIONS, RATE_LIMIT_SQL_EXECUTOR } from '../tokens';

/** Rejections are counted per minute — the row's `window_start`. */
export const REJECTION_WINDOW_MS = 60_000;

/** The identifier a rejection is counted under once the buffer is full — the route's total stays exact, only the per-source split is lost. */
export const OVERFLOW_IDENTIFIER = '(overflow)';

export interface PostgresRateLimitEventRecorderOptions {
  /** How often buffered counts are written. Default 10s — at most this much is lost if the process dies. */
  flushIntervalMs?: number;
  /** Distinct sources held between flushes before new ones are counted under `OVERFLOW_IDENTIFIER`. Default 10,000. */
  maxBufferedKeys?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const DEFAULT_MAX_BUFFERED_KEYS = 10_000;
/** Rows per INSERT — 9 params each, well under Postgres' 65,535-parameter cap. */
const ROWS_PER_INSERT = 1_000;

interface BufferedWindow {
  route: string;
  identifier: string;
  limit: number;
  ttlMs: number;
  windowStart: Date;
  correlationId: string | null;
  count: number;
  firstRejectedAt: Date;
  lastRejectedAt: Date;
}

/**
 * Reference `RateLimitEventRecorder` for Postgres. A rejection is counted in
 * memory — no I/O on the `429` path — and the counts are upserted every
 * `flushIntervalMs` as one row per route, identifier, limit, minute and
 * correlation id. So a flood costs one row per source per minute, however many
 * requests it sends; several instances upsert into the same rows.
 *
 * Best-effort by contract: a failed flush is logged and its counts dropped,
 * never retried or propagated. The buffer is flushed once more on shutdown.
 */
@Injectable()
export class PostgresRateLimitEventRecorder implements RateLimitEventRecorder, OnModuleDestroy {
  private readonly logger = new Logger(PostgresRateLimitEventRecorder.name);
  private readonly maxBufferedKeys: number;
  private readonly timer: NodeJS.Timeout;
  private buffer = new Map<string, BufferedWindow>();
  private flushing = false;

  constructor(
    @Inject(RATE_LIMIT_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(RATE_LIMIT_APPLICATION_ID) private readonly application: string,
    @Optional() @Inject(RATE_LIMIT_RECORDER_OPTIONS) options: PostgresRateLimitEventRecorderOptions = {},
  ) {
    this.maxBufferedKeys = options.maxBufferedKeys ?? DEFAULT_MAX_BUFFERED_KEYS;
    // Started here, not in onModuleInit, so a hand-constructed recorder flushes too; unref'd so it never holds the process open.
    this.timer = setInterval(() => void this.flush(), options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  async recordRejection(rejection: RateLimitRejection): Promise<void> {
    const now = new Date();
    const windowStart = new Date(Math.floor(now.getTime() / REJECTION_WINDOW_MS) * REJECTION_WINDOW_MS);
    let identifier = rejection.identifier;
    let correlationId = rejection.correlationId ?? null;
    let key = windowKey(rejection, identifier, windowStart, correlationId);

    if (!this.buffer.has(key) && this.buffer.size >= this.maxBufferedKeys) {
      // One overflow row per route and limit — bounded by the routes, not by the sources.
      identifier = OVERFLOW_IDENTIFIER;
      correlationId = null;
      key = windowKey(rejection, identifier, windowStart, correlationId);
    }

    const existing = this.buffer.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastRejectedAt = now;
      return;
    }
    this.buffer.set(key, {
      route: rejection.route,
      identifier,
      limit: rejection.limit,
      ttlMs: rejection.ttlMs,
      windowStart,
      correlationId,
      count: 1,
      firstRejectedAt: now,
      lastRejectedAt: now,
    });
  }

  /** Writes and clears the buffer. A tick that lands while a flush is still running is skipped — the buffer keeps counting. */
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
      const dropped = windows.reduce((sum, w) => sum + w.count, 0);
      this.logger.error(
        `Failed to record ${dropped} rate-limit rejection(s) — the 429s themselves are unaffected`,
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.flushing = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }

  private async upsert(windows: BufferedWindow[]): Promise<void> {
    const values = windows.map(
      (w) => sql`(
        ${this.application}, ${w.route}, ${w.identifier}, ${w.limit}, ${w.ttlMs}, ${w.windowStart},
        ${w.count}, ${w.firstRejectedAt}, ${w.lastRejectedAt}, ${w.correlationId}
      )`,
    );
    await this.db.execute(sql`
      insert into commons_rate_limit_rejection as r
        (application, route, identifier, "limit", ttl_ms, window_start, rejection_count, first_rejected_at, last_rejected_at, correlation_id)
      values ${sql.join(values, sql`, `)}
      on conflict (application, route, identifier, "limit", ttl_ms, window_start, correlation_id) do update set
        rejection_count = r.rejection_count + excluded.rejection_count,
        first_rejected_at = least(r.first_rejected_at, excluded.first_rejected_at),
        last_rejected_at = greatest(r.last_rejected_at, excluded.last_rejected_at)
    `);
  }
}

function windowKey(r: RateLimitRejection, identifier: string, windowStart: Date, correlationId: string | null): string {
  return JSON.stringify([r.route, identifier, r.limit, r.ttlMs, windowStart.getTime(), correlationId]);
}
