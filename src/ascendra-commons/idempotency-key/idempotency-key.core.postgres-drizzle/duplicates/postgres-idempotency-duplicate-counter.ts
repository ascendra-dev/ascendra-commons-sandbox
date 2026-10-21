import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SqlExecutor } from '../persistence/sql-executor';
import { IDEMPOTENCY_DUPLICATE_COUNTER_OPTIONS, IDEMPOTENCY_SQL_EXECUTOR } from '../tokens';

/** A repeat request `claim()` answered without running the handler. */
export type DuplicateOutcome = 'replayed' | 'conflict';

export interface PostgresIdempotencyDuplicateCounterOptions {
  /** How often buffered counts are written. Default 10s — at most this much is lost if the process dies. */
  flushIntervalMs?: number;
  /** Distinct claims held between flushes; duplicates on further claims are dropped (and the drop logged). Default 10,000. */
  maxBufferedKeys?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const DEFAULT_MAX_BUFFERED_KEYS = 10_000;
/** Rows per UPDATE — 5 params each, well under Postgres' 65,535-parameter cap. */
const ROWS_PER_UPDATE = 1_000;

interface BufferedCount {
  key: string;
  scope: string;
  replays: number;
  conflicts: number;
  lastAt: Date;
}

/**
 * Counts the duplicates `PostgresIdempotencyStore.claim()` answers — a replayed saved response, a `409` while the
 * first request is still running — in memory, and adds them onto the claim rows every `flushIntervalMs` in one
 * `UPDATE … FROM (VALUES …)` per chunk. So a client hammering one key costs no extra write per request: one row
 * update per claim per flush, however many repeats it sent. Several instances add into the same rows.
 *
 * Best-effort by contract: a failed flush is logged and its counts dropped, never retried or propagated — the replay
 * or `409` the client got is unaffected. A count for a claim pruned before the flush is a no-op. The buffer is
 * flushed once more on shutdown.
 */
@Injectable()
export class PostgresIdempotencyDuplicateCounter implements OnModuleDestroy {
  private readonly logger = new Logger(PostgresIdempotencyDuplicateCounter.name);
  private readonly maxBufferedKeys: number;
  private readonly timer: NodeJS.Timeout;
  private buffer = new Map<string, BufferedCount>();
  private dropped = 0;
  private flushing = false;

  constructor(
    @Inject(IDEMPOTENCY_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Optional() @Inject(IDEMPOTENCY_DUPLICATE_COUNTER_OPTIONS) options: PostgresIdempotencyDuplicateCounterOptions = {},
  ) {
    this.maxBufferedKeys = options.maxBufferedKeys ?? DEFAULT_MAX_BUFFERED_KEYS;
    // Started here, not in onModuleInit, so a hand-constructed counter flushes too; unref'd so it never holds the process open.
    this.timer = setInterval(() => void this.flush(), options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  /** Synchronous and in-memory — safe on the request path. */
  record(key: string, scope: string, outcome: DuplicateOutcome): void {
    const id = JSON.stringify([key, scope]);
    let count = this.buffer.get(id);
    if (!count) {
      if (this.buffer.size >= this.maxBufferedKeys) {
        this.dropped += 1;
        return;
      }
      count = { key, scope, replays: 0, conflicts: 0, lastAt: new Date() };
      this.buffer.set(id, count);
    }
    if (outcome === 'replayed') count.replays += 1;
    else count.conflicts += 1;
    count.lastAt = new Date();
  }

  /** Writes and clears the buffer. A tick that lands while a flush is still running is skipped — the buffer keeps counting. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.dropped > 0) {
      // Not silent: a full buffer means a burst across more claims than maxBufferedKeys in one interval.
      this.logger.warn(
        `${this.dropped} duplicate request(s) not counted — more than ${this.maxBufferedKeys} claims had duplicates ` +
          `within one flush interval. Raise maxBufferedKeys or shorten flushIntervalMs.`,
      );
      this.dropped = 0;
    }
    if (this.buffer.size === 0) return;
    this.flushing = true;
    const counts = [...this.buffer.values()];
    this.buffer = new Map();
    try {
      for (let i = 0; i < counts.length; i += ROWS_PER_UPDATE) {
        await this.add(counts.slice(i, i + ROWS_PER_UPDATE));
      }
    } catch (err) {
      const lost = counts.reduce((sum, c) => sum + c.replays + c.conflicts, 0);
      this.logger.error(
        `Failed to record ${lost} duplicate request(s) — the replays and 409s themselves are unaffected`,
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

  private async add(counts: BufferedCount[]): Promise<void> {
    const values = counts.map(
      (c) => sql`(${c.key}, ${c.scope}, ${c.replays}::int, ${c.conflicts}::int, ${c.lastAt}::timestamptz)`,
    );
    await this.db.execute(sql`
      update commons_idempotency_key as k set
        replay_count = k.replay_count + v.replays,
        conflict_count = k.conflict_count + v.conflicts,
        last_duplicate_at = greatest(k.last_duplicate_at, v.last_at)
      from (values ${sql.join(values, sql`, `)}) as v(key, scope, replays, conflicts, last_at)
      where k.key = v.key and k.scope = v.scope
    `);
  }
}
