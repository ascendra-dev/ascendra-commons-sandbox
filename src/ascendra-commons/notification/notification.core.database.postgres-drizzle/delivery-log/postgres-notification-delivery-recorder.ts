import { Inject, Injectable, Logger, Optional, type OnModuleDestroy } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  DeliveryAttempt,
  DeliveryStatusUpdate,
  NotificationDeliveryRecorder,
} from '../../notification.core';
import type { SqlExecutor } from '../persistence/sql-executor';
import {
  NOTIFICATION_ADMIN_APPLICATION_ID,
  NOTIFICATION_ADMIN_SQL_EXECUTOR,
  NOTIFICATION_ADMIN_STORE_CONTENT,
  NOTIFICATION_DELIVERY_RECORDER_OPTIONS,
} from '../tokens';

export interface PostgresNotificationDeliveryRecorderOptions {
  /** How often the buffer is written. Default 2 s — a test send shows in the log about that soon. */
  flushIntervalMs?: number;
  /**
   * Rows held while the database can't be written. Default 50,000 — past it the oldest are dropped (and the next
   * write logs how many), so a database outage can't exhaust the process's memory.
   */
  maxBufferedRows?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 2_000;
const DEFAULT_MAX_BUFFERED_ROWS = 50_000;
/** A batch this big is written at once, without waiting for the timer. 1,000 rows × 15 params stays far under 65,535. */
const ROWS_PER_INSERT = 1_000;
const MAX_TEXT = 256;
const MAX_REASON = 1_000;
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

interface BufferedRow {
  notificationType: string;
  channel: string;
  tenantId: string | null;
  recipientRef: string;
  recipientKey: string | null;
  status: 'sent' | 'failed' | 'skipped';
  reason: string | null;
  providerMessageId: string | null;
  attemptedAt: Date;
  correlationId: string | null;
  /** Already serialized jsonb text — or null (not stored, or it wouldn't serialize). */
  content: string | null;
  test: boolean;
  retryOf: string | null;
}

/** Storable text: no NUL (Postgres `text` rejects it), bounded. */
function text(value: unknown, max: number): string | null {
  const s = typeof value === 'string' ? value.replaceAll('\u0000', '') : '';
  if (s.length === 0) return null;
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * Reference `NotificationDeliveryRecorder` for Postgres — **buffered**: `recordAttempts` only queues the rows, and
 * they're written every `flushIntervalMs` (or at once when a batch fills), in multi-row `INSERT`s of up to 1,000.
 * A send never waits on the delivery log — a batch of 10,000 reminders doesn't make 10,000 round trips on its own
 * path.
 *
 * Each row is normalized as it's buffered (no NUL, bounded text, a valid date, content that serializes), so one
 * malformed value can't sink a batch. Best-effort by contract: a failed write is logged with how many rows it lost,
 * never thrown — the notifications themselves are unaffected. The buffer is written on shutdown
 * (`app.enableShutdownHooks()`); a status update from a provider webhook writes it first, so it never misses a row
 * still waiting.
 *
 * Corresponding table: `../persistence/delivery.schema.ts` (DDL: `../migrations/`).
 */
@Injectable()
export class PostgresNotificationDeliveryRecorder implements NotificationDeliveryRecorder, OnModuleDestroy {
  private readonly logger = new Logger(PostgresNotificationDeliveryRecorder.name);
  private readonly maxBufferedRows: number;
  private readonly timer: NodeJS.Timeout;
  private buffer: BufferedRow[] = [];
  private dropped = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
    @Inject(NOTIFICATION_ADMIN_STORE_CONTENT) private readonly storeContent: boolean,
    @Optional() @Inject(NOTIFICATION_DELIVERY_RECORDER_OPTIONS) options: PostgresNotificationDeliveryRecorderOptions = {},
  ) {
    this.maxBufferedRows = Math.max(ROWS_PER_INSERT, options.maxBufferedRows ?? DEFAULT_MAX_BUFFERED_ROWS);
    // Started here so a hand-constructed recorder flushes too; unref'd so it never holds the process open.
    this.timer = setInterval(() => void this.flush(), Math.max(100, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS));
    this.timer.unref();
  }

  async recordAttempts(attempts: DeliveryAttempt[]): Promise<void> {
    for (const attempt of attempts) {
      try {
        this.buffer.push(this.normalize(attempt));
      } catch (err) {
        this.logger.error('Could not buffer a notification delivery row — dropped', err instanceof Error ? err.stack : String(err));
      }
    }
    if (this.buffer.length > this.maxBufferedRows) {
      const excess = this.buffer.length - this.maxBufferedRows;
      this.buffer.splice(0, excess);
      this.dropped += excess;
    }
    if (this.buffer.length >= ROWS_PER_INSERT) void this.flush();
  }

  async updateDeliveryStatus(update: DeliveryStatusUpdate): Promise<void> {
    // The row may still be in the buffer — a fast provider calls back within the flush interval.
    await this.flush();
    try {
      await this.db.execute(sql`
        update commons_notification_delivery
        set status = ${update.status},
            reason = coalesce(${text(update.detail, MAX_REASON)}, reason),
            updated_at = now()
        where application = ${this.application} and provider_message_id = ${update.providerMessageId}
      `);
      if (update.suppress) await this.suppress(update);
    } catch (err) {
      this.logger.error(
        `Failed to apply delivery-status update for provider message "${update.providerMessageId}"`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * A hard bounce or a complaint — file the delivery's recipient key in the suppression list (a repeat counts). A row
   * without a key (a guest, with no `recipientHashKey`) can't be suppressed.
   */
  private async suppress(update: DeliveryStatusUpdate): Promise<void> {
    await this.db.execute(sql`
      insert into commons_notification_suppression as s
        (application, channel, recipient_key, tenant_id, reason, detail)
      select d.application, d.channel, d.recipient_key, d.tenant_id, ${update.status}, ${text(update.detail, MAX_REASON)}
      from commons_notification_delivery d
      where d.application = ${this.application} and d.provider_message_id = ${update.providerMessageId}
        and d.recipient_key is not null
      on conflict on constraint commons_notification_suppression_uq do update set
        last_at = now(), event_count = s.event_count + 1, reason = excluded.reason, detail = excluded.detail
    `);
  }

  /** Writes what's buffered. Concurrent calls share one write, then write anything buffered since. */
  async flush(): Promise<void> {
    while (this.inflight) await this.inflight;
    if (this.buffer.length === 0) return;
    this.inflight = this.write().finally(() => {
      this.inflight = null;
    });
    await this.inflight;
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }

  private async write(): Promise<void> {
    const rows = this.buffer;
    this.buffer = [];
    if (this.dropped > 0) {
      this.logger.error(`Dropped ${this.dropped} notification delivery row(s) — the buffer was full (the database unreachable?)`);
      this.dropped = 0;
    }
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
      const chunk = rows.slice(i, i + ROWS_PER_INSERT);
      try {
        await this.insert(chunk);
      } catch (err) {
        this.logger.error(
          `Failed to record ${chunk.length} notification delivery row(s) — delivery outcome is unaffected`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private normalize(a: DeliveryAttempt): BufferedRow {
    const attemptedAt = a.attemptedAt instanceof Date && !Number.isNaN(a.attemptedAt.getTime()) ? a.attemptedAt : new Date();
    const correlationId = typeof a.correlationId === 'string' && CORRELATION_ID.test(a.correlationId) ? a.correlationId : null;
    return {
      notificationType: text(a.notificationType, MAX_TEXT) ?? '(unknown)',
      channel: text(a.channel, MAX_TEXT) ?? '(unknown)',
      tenantId: a.tenantId == null ? null : text(a.tenantId, MAX_TEXT),
      recipientRef: text(a.recipientRef, MAX_TEXT) ?? 'raw',
      recipientKey: text(a.recipientKey, MAX_TEXT),
      status: a.status === 'sent' || a.status === 'skipped' ? a.status : 'failed',
      reason: text(a.reason, MAX_REASON),
      providerMessageId: text(a.providerMessageId, MAX_TEXT),
      attemptedAt,
      correlationId,
      content: this.storeContent && a.content ? serializeContent(a.content) : null,
      test: a.test === true,
      retryOf: typeof a.retryOf === 'string' && /^\d{1,19}$/.test(a.retryOf) ? a.retryOf : null,
    };
  }

  private async insert(rows: BufferedRow[]): Promise<void> {
    const values: SQL[] = rows.map(
      (r) => sql`(
        ${this.application}, ${r.notificationType}, ${r.channel}, ${r.tenantId},
        ${r.recipientRef}, ${r.recipientKey}, ${r.status}, ${r.reason}, ${r.providerMessageId},
        ${r.attemptedAt}, ${r.attemptedAt}, ${r.correlationId}, ${r.content === null ? sql`null` : sql`${r.content}::jsonb`}, ${r.test},
        ${r.retryOf === null ? sql`null` : sql`${r.retryOf}::bigint`}
      )`,
    );
    await this.db.execute(sql`
      insert into commons_notification_delivery
        (application, notification_type, channel, tenant_id, recipient_ref, recipient_key, status, reason,
         provider_message_id, attempted_at, updated_at, correlation_id, content, is_test, retry_of)
      values ${sql.join(values, sql`, `)}
    `);
  }
}

/** The content as jsonb text — or null when it won't serialize. `jsonb` rejects the `\u0000` escape, so it's removed. */
function serializeContent(content: unknown): string | null {
  try {
    const json = JSON.stringify(content);
    return json === undefined ? null : json.replaceAll('\\u0000', '');
  } catch {
    return null;
  }
}
