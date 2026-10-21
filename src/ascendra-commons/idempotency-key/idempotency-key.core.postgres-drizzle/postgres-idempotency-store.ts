import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CachedResponse, ClaimContext, ClaimResult, IdempotencyStore, IdempotencyStoreOptions } from '../idempotency-key.core';
import { PostgresIdempotencyDuplicateCounter } from './duplicates/postgres-idempotency-duplicate-counter';
import type { SqlExecutor } from './persistence/sql-executor';
import { IDEMPOTENCY_SQL_EXECUTOR, IDEMPOTENCY_STORE_OPTIONS } from './tokens';

/** What the fallback/classify path returns — a `ClaimResult` minus `'claimed'`. */
type ExistingResult = Exclude<ClaimResult, { status: 'claimed' }>;

/**
 * The atomic claim for Postgres/Drizzle (Model 1). Corresponding table:
 * `persistence/idempotency-key.schema.ts` (DDL: `migrations/`).
 *
 * `claim()` is one `INSERT … ON CONFLICT DO UPDATE … WHERE (stale) … RETURNING` —
 * atomic regardless of node, the guarantee from Postgres's conflict handling on
 * the `(key, scope)` primary key. A fresh insert *and* a stale-reclaim both
 * return one row (`rows.length === 1` = "I own it"); a recent-pending or
 * completed conflict returns zero, and the fallback read classifies it.
 *
 * `(xmax = 0) as inserted` (a standard Postgres idiom) is how that one atomic
 * statement also tells a brand-new row apart from a reclaimed one: `xmax` is
 * the deleting-transaction id Postgres stamps on every row version, `0` on a
 * row nobody has ever updated. A plain `INSERT` produces `xmax = 0`; the `DO
 * UPDATE` branch produces a new row version with `xmax != 0`. No second query,
 * no race — `reclaimedStale` falls straight out of the same statement that
 * won the claim. `reclaim_count` is incremented in that same `DO UPDATE SET`,
 * so counting a reclaim can never itself race the claim it's counting.
 *
 * Every claim carries a fresh `claim_id`. `complete()` is guarded
 * `WHERE claim_id = $claimId`, so a claim reclaimed as stale (its `claim_id`
 * overwritten by the new owner) can no longer write its response — its
 * `complete()` is a 0-row no-op instead of corrupting the current owner's
 * cached response. This does not stop the duplicate side-effect (once a
 * still-in-flight claim is reclaimed by time, both run) — it keeps the cache
 * consistent with what the current owner's client saw. That no-op is now
 * itself recorded (`late_complete_no_op_count`, logged) rather than silently
 * discarded — it's the one unambiguous signal that a duplicate actually ran.
 *
 * A duplicate `claim()` answers — a replayed `'completed'`, an `'in_progress'`
 * `409` — is counted by `PostgresIdempotencyDuplicateCounter`: in memory on
 * the request, added to the row in batches. The duplicate path keeps its two
 * queries, no more.
 */
@Injectable()
export class PostgresIdempotencyStore implements IdempotencyStore {
  private readonly logger = new Logger(PostgresIdempotencyStore.name);

  constructor(
    @Inject(IDEMPOTENCY_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(IDEMPOTENCY_STORE_OPTIONS) private readonly options: IdempotencyStoreOptions,
    @Inject(PostgresIdempotencyDuplicateCounter) private readonly duplicates: PostgresIdempotencyDuplicateCounter,
  ) {}

  async claim(key: string, scope: string, context: ClaimContext = {}): Promise<ClaimResult> {
    const claimId = randomUUID();
    const correlationId = context.correlationId ?? null;
    const route = context.route ?? null;

    const won = await this.db.execute(sql`
      insert into commons_idempotency_key (key, scope, status, claim_id, correlation_id, route)
      values (${key}, ${scope}, 'pending', ${claimId}, ${correlationId}, ${route})
      on conflict (key, scope) do update
        set status = 'pending', created_at = now(), claim_id = ${claimId},
            correlation_id = ${correlationId}, route = ${route},
            reclaim_count = commons_idempotency_key.reclaim_count + 1
        where commons_idempotency_key.status = 'pending'
          and commons_idempotency_key.created_at < now() - make_interval(secs => ${this.options.staleAfterSeconds})
      returning claim_id, (xmax = 0) as inserted
    `);
    if (won.rows.length === 1) {
      return { status: 'claimed', claimId, reclaimedStale: won.rows[0].inserted !== true };
    }

    let row = await this.readRow(key, scope);
    if (!row) {
      // The row this same attempt just failed to win could have been deleted (a cleanup job)
      // between that attempt and this read. Re-claim race-safely — never just report 'claimed'
      // without writing the row (complete() would have nothing to update, no concurrent
      // duplicate would be caught), and never a plain INSERT that PK-violates on a concurrent
      // re-claim. Not a "reclaim" in the stale-owner sense (the row was gone, not abandoned) —
      // reclaimedStale is false here.
      const reclaimed = await this.db.execute(sql`
        insert into commons_idempotency_key (key, scope, status, claim_id, correlation_id, route)
        values (${key}, ${scope}, 'pending', ${claimId}, ${correlationId}, ${route})
        on conflict (key, scope) do nothing
        returning claim_id
      `);
      if (reclaimed.rows.length === 1) return { status: 'claimed', claimId, reclaimedStale: false };
      row = await this.readRow(key, scope); // someone else won the re-claim — read their row
    }
    const result = this.classify(row);
    this.duplicates.record(key, scope, result.status === 'completed' ? 'replayed' : 'conflict');
    return result;
  }

  async complete(key: string, scope: string, claimId: string, response: CachedResponse): Promise<void> {
    const updated = await this.db.execute(sql`
      update commons_idempotency_key
      set status = 'completed', status_code = ${response.statusCode}, response_body = ${response.body}
      where key = ${key} and scope = ${scope} and claim_id = ${claimId}
      returning key
    `);
    if (updated.rows.length > 0) return;

    // This claim was reclaimed as stale before this attempt finished — its result is being
    // dropped by design (see IdempotencyStore's own doc comment), but that is exactly the
    // duplicate-processing scenario staleAfterSeconds's doc comment warns about actually
    // happening. Recorded best-effort so it isn't invisible; never lets a logging/counting
    // failure surface past complete()'s own "never overwrite the current owner" contract.
    this.logger.warn(
      `complete() no-op for key="${key}" scope="${scope}" — the claim was reclaimed as stale ` +
        `before this attempt finished. This attempt's result was discarded; if the original ` +
        `owner was still genuinely running, a duplicate execution just happened.`,
    );
    try {
      await this.db.execute(sql`
        update commons_idempotency_key
        set late_complete_no_op_count = late_complete_no_op_count + 1
        where key = ${key} and scope = ${scope}
      `);
    } catch (err) {
      this.logger.error(
        `Failed to record a late-complete no-op for key="${key}" scope="${scope}"`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async readRow(key: string, scope: string): Promise<Record<string, unknown> | undefined> {
    const { rows } = await this.db.execute(sql`
      select status, status_code, response_body from commons_idempotency_key where key = ${key} and scope = ${scope}
    `);
    return rows[0];
  }

  private classify(row: Record<string, unknown> | undefined): ExistingResult {
    if (!row) return { status: 'in_progress' }; // pathological: deleted again mid-race; treat as concurrent
    return row.status === 'completed'
      ? { status: 'completed', response: { statusCode: row.status_code as number, body: row.response_body } }
      : { status: 'in_progress' };
  }
}
