import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { DOMAIN_EVENT_EMITTER, type DomainEventEmitter } from '../ascendra-commons/domain-events/domain-events.core';
import { PostgresIdempotencyDuplicateCounter } from '../ascendra-commons/idempotency-key/idempotency-key.core.postgres-drizzle';
import {
  POSTGRES_RATE_LIMIT_EVENT_RECORDER,
  type PostgresRateLimitEventRecorder,
} from '../ascendra-commons/rate-limiting/rate-limiting.core.postgres-drizzle';
import { DATABASE_CONNECTION, type Database } from '../db/database.module';
import { parseArgs } from './args';
import { AuditHistory } from './audit-history';
import { IdempotencyHistory } from './idempotency-history';
import { startHttpApp } from './http-app';
import { RateLimitHistory } from './rate-limit-history';
import { Rng } from './rng';

const VOLUMES: Record<string, number> = { small: 0.3, normal: 1, large: 25 };

/**
 *   npm run seed -- [--days 90] [--seed 42] [--volume small|normal|large]
 *
 * Generates audit history (see audit-history.ts), rate-limit rejections (rate-limit-history.ts) and idempotency claims
 * (idempotency-history.ts) — the last two recent only — into an empty database. Same --seed → same records (only their own uuids and "now" differ). Refuses a database that
 * already has audit records — run db:reset.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2), { days: 'number', seed: 'number', volume: 'string' });
  const days = (args.days as number | undefined) ?? 90;
  const seed = (args.seed as number | undefined) ?? 42;
  const volumeName = (args.volume as string | undefined) ?? 'normal';
  const volume = VOLUMES[volumeName];
  if (!volume) throw new Error(`--volume must be one of ${Object.keys(VOLUMES).join(', ')}`);
  if (days < 1 || days > 400) throw new Error('--days must be between 1 and 400');

  // The whole API on a local port — audit is driven in-process, rate-limiting over HTTP (only its guard records).
  const { app, baseUrl } = await startHttpApp();
  try {
    const db = app.get<Database>(DATABASE_CONNECTION, { strict: false });
    const { rows } = await db.execute(sql`select count(*)::int as n from commons_audit_event`);
    if ((rows[0].n as number) > 0) throw new Error('The database already has audit records — run `npm run db:reset` (it seeds too).');

    console.log(`Seeding ${days} days of audit history (seed ${seed}, volume ${volumeName}) …`);
    const started = Date.now();
    await new AuditHistory(app.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER, { strict: false }), new Rng(seed)).run({
      days, volume, until: new Date(),
      onDay: (day, all) => { if (day % 10 === 0 || day === all) console.log(`  day ${day}/${all}`); },
    });

    const summary = await db.execute(sql`select entity_type, count(*)::int as n from commons_audit_event group by 1 order by 2 desc`);
    const count = summary.rows.reduce((sum, r) => sum + (r.n as number), 0);
    console.log(`✓ ${count} audit records in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
      summary.rows.map((r) => `${r.entity_type} ${r.n}`).join(', '));

    console.log('Driving throttled endpoints for rate-limit rejections …');
    const limits = await new RateLimitHistory(baseUrl, new Rng(seed)).run();
    // Write the recorder's buffer now rather than on its next tick, so the summary sees it.
    await app.get<PostgresRateLimitEventRecorder>(POSTGRES_RATE_LIMIT_EVENT_RECORDER, { strict: false }).flush();
    const windows = await db.execute(sql`select count(*)::int as n, coalesce(sum(rejection_count), 0)::int as total from commons_rate_limit_rejection`);
    console.log(`✓ ${limits.requests} requests, ${limits.rejected} rejected → ${windows.rows[0].n} rejection windows (${windows.rows[0].total} counted)`);

    console.log('Driving idempotent endpoints for idempotency claims (~10s — two cases wait out the stale window) …');
    const claims = await new IdempotencyHistory(baseUrl, new Rng(seed)).run(volume);
    // Write the counted replays and 409s now rather than on the next tick, so the summary sees them.
    await app.get(PostgresIdempotencyDuplicateCounter, { strict: false }).flush();
    const keys = await db.execute(sql`
      select count(*)::int as n, count(*) filter (where status = 'pending')::int as pending,
             coalesce(sum(replay_count), 0)::int as replays, coalesce(sum(conflict_count), 0)::int as conflicts,
             count(*) filter (where reclaim_count > 0)::int as reclaimed, coalesce(sum(late_complete_no_op_count), 0)::int as ran_twice
      from commons_idempotency_key`);
    const k = keys.rows[0];
    const statuses = Object.entries(claims.byStatus).map(([code, n]) => `${code}×${n}`).join(' ');
    console.log(`✓ ${claims.requests} requests (${statuses}) → ${k.n} claims: ${k.replays} replayed, ${k.conflicts} turned away, ` +
      `${k.pending} in progress, ${k.reclaimed} reclaimed, ${k.ran_twice} ran twice`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
