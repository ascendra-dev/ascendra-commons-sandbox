import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { EventDeliveryAttempt, EventDeliveryRecorder } from '../../domain-events.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import { EVENT_DELIVERY_APPLICATION_ID, EVENT_DELIVERY_RECORDER_OPTIONS, EVENT_DELIVERY_SQL_EXECUTOR } from '../tokens';

export interface PostgresEventDeliveryRecorderOptions {
  /** How often buffered deliveries are written. Default 10s — at most this much is lost if the process dies. */
  flushIntervalMs?: number;
  /** Deliveries held between flushes; further ones are dropped (and the drop logged) until the next flush. Default 10,000. */
  maxBufferedRows?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const DEFAULT_MAX_BUFFERED_ROWS = 10_000;
/** Rows per INSERT — 10 params each, well under Postgres' 65,535-parameter cap. */
const ROWS_PER_INSERT = 1_000;

/**
 * A correlation id worth storing — the caller usually passes a request header through, so anything else is dropped
 * rather than recorded. Same rule as `audit-logging` and `rate-limiting`, duplicated so each module stays copyable.
 */
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * A time the INSERT can take: the event's own `occurredAt` when it's a real date — or a string / number that parses as
 * one, as it is once an event has been through JSON — else when it was recorded. Never undefined or an Invalid Date:
 * one such value fails the whole multi-row INSERT, and every good delivery in the batch with it.
 */
function occurredAtOf(value: unknown, recordedAt: Date): Date {
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : recordedAt;
}

/** Text Postgres can store: a NUL byte fails the INSERT (and the batch). Error messages, in `reason`, can carry one. */
const text = (value: unknown, fallback: string) => (value == null || value === '' ? fallback : String(value).replaceAll('\u0000', ''));

interface BufferedDelivery {
  eventName: string;
  method: EventDeliveryAttempt['method'];
  transport: string;
  occurredAt: Date;
  deliveredAt: Date;
  listenerCount: number;
  status: EventDeliveryAttempt['status'];
  reason: string | null;
  correlationId: string | null;
}

/**
 * Reference `EventDeliveryRecorder` for Postgres. A delivery is buffered in memory — no I/O on the `emit()` /
 * `emitCritical()` path, which runs inside every producer's own request — and the buffer is written every
 * `flushIntervalMs` in multi-row `INSERT`s, one row per delivery. Several instances write into the same table.
 *
 * Best-effort by contract: a failed flush is logged with how many deliveries it lost, never retried or propagated;
 * past `maxBufferedRows` in one interval, further deliveries are dropped and counted in the next flush's log. The
 * buffer is flushed once more on shutdown (`app.enableShutdownHooks()`).
 *
 * Corresponding table: `../persistence/domain-event-delivery.schema.ts` (DDL: `../migrations/`).
 */
@Injectable()
export class PostgresEventDeliveryRecorder implements EventDeliveryRecorder, OnModuleDestroy {
  private readonly logger = new Logger(PostgresEventDeliveryRecorder.name);
  private readonly maxBufferedRows: number;
  private readonly timer: NodeJS.Timeout;
  private buffer: BufferedDelivery[] = [];
  private dropped = 0;
  private flushing = false;

  constructor(
    @Inject(EVENT_DELIVERY_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(EVENT_DELIVERY_APPLICATION_ID) private readonly application: string,
    @Optional() @Inject(EVENT_DELIVERY_RECORDER_OPTIONS) options: PostgresEventDeliveryRecorderOptions = {},
  ) {
    this.maxBufferedRows = options.maxBufferedRows ?? DEFAULT_MAX_BUFFERED_ROWS;
    // Started here, not in onModuleInit, so a hand-constructed recorder flushes too; unref'd so it never holds the process open.
    this.timer = setInterval(() => void this.flush(), options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  /** In memory only — safe on the producer's path. */
  async recordDelivery(attempt: EventDeliveryAttempt): Promise<void> {
    if (this.buffer.length >= this.maxBufferedRows) {
      this.dropped += 1;
      return;
    }
    // Normalized here, one delivery at a time — a malformed attempt must cost only itself, never the batch it lands in.
    const deliveredAt = new Date();
    this.buffer.push({
      eventName: text(attempt.eventName, '(unnamed)'),
      method: attempt.method === 'emitCritical' ? 'emitCritical' : 'emit',
      transport: text(attempt.transport, 'unknown'),
      occurredAt: occurredAtOf(attempt.occurredAt, deliveredAt),
      deliveredAt,
      listenerCount: Number.isInteger(attempt.listenerCount) && attempt.listenerCount >= 0 ? attempt.listenerCount : 0,
      status: attempt.status,
      reason: attempt.reason == null ? null : text(attempt.reason, ''),
      correlationId: attempt.correlationId && CORRELATION_ID.test(attempt.correlationId) ? attempt.correlationId : null,
    });
  }

  /** Writes and clears the buffer. A tick that lands while a flush is still running is skipped — the buffer keeps filling. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.dropped > 0) {
      // Not silent: a full buffer means more than maxBufferedRows deliveries within one interval.
      this.logger.warn(
        `${this.dropped} event delivery(ies) not recorded — more than ${this.maxBufferedRows} within one flush ` +
          `interval. Raise maxBufferedRows or shorten flushIntervalMs.`,
      );
      this.dropped = 0;
    }
    if (this.buffer.length === 0) return;
    this.flushing = true;
    const rows = this.buffer;
    this.buffer = [];
    try {
      for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
        await this.insert(rows.slice(i, i + ROWS_PER_INSERT));
      }
    } catch (err) {
      this.logger.error(
        `Failed to record ${rows.length} event delivery(ies) — the emits themselves are unaffected`,
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

  private async insert(rows: BufferedDelivery[]): Promise<void> {
    const values = rows.map(
      (r) => sql`(
        ${this.application}, ${r.eventName}, ${r.method}, ${r.transport}, ${r.occurredAt}, ${r.deliveredAt},
        ${r.listenerCount}, ${r.status}, ${r.reason}, ${r.correlationId}
      )`,
    );
    await this.db.execute(sql`
      insert into commons_domain_events_delivery
        (application, event_name, method, transport, occurred_at, delivered_at, listener_count, status, reason, correlation_id)
      values ${sql.join(values, sql`, `)}
    `);
  }
}
