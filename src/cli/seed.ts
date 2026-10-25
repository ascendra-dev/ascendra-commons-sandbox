import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { DOMAIN_EVENT_EMITTER, type DomainEventEmitter } from '../ascendra-commons/domain-events/domain-events.core';
import {
  POSTGRES_EVENT_DELIVERY_RECORDER,
  type PostgresEventDeliveryRecorder,
} from '../ascendra-commons/domain-events/domain-events.core.postgres-drizzle';
import { PostgresIdempotencyDuplicateCounter } from '../ascendra-commons/idempotency-key/idempotency-key.core.postgres-drizzle';
import {
  POSTGRES_RATE_LIMIT_EVENT_RECORDER,
  type PostgresRateLimitEventRecorder,
} from '../ascendra-commons/rate-limiting/rate-limiting.core.postgres-drizzle';
import { POSTGRES_JOB_RUN_RECORDER } from '../ascendra-commons/background-jobs/background-jobs.core.postgres-drizzle';
import type { JobRunRecorder } from '../ascendra-commons/background-jobs/background-jobs.core';
import {
  POSTGRES_ACCESS_DENIAL_RECORDER,
  type PostgresAccessDenialRecorder,
} from '../ascendra-commons/authorization/authorization.core.permission-table.postgres-drizzle';
import { DATABASE_CONNECTION, type Database } from '../db/database.module';
import { parseArgs } from './args';
import { AccessHistory } from './access-history';
import { AuditHistory } from './audit-history';
import { DomainEventHistory } from './domain-event-history';
import { IdempotencyHistory } from './idempotency-history';
import { JobHistory } from './job-history';
import { startHttpApp } from './http-app';
import { RateLimitHistory } from './rate-limit-history';
import { NotificationHistory } from './notification-history';
import {
  NOTIFICATION_RECIPIENT_HASHER,
  NOTIFIER,
  type NotificationRecipientHasher,
  type Notifier,
} from '../ascendra-commons/notification/notification.core';
import {
  POSTGRES_NOTIFICATION_DELIVERY_RECORDER,
  PostgresNotificationRetentionService,
  type PostgresNotificationDeliveryRecorder,
} from '../ascendra-commons/notification/notification.core.database.postgres-drizzle';
import { Rng } from './rng';

const VOLUMES: Record<string, number> = { small: 0.3, normal: 1, large: 25 };

/**
 *   npm run seed -- [--days 90] [--seed 42] [--volume small|normal|large]
 *
 * Generates audit history (see audit-history.ts), domain-event deliveries (domain-event-history.ts — audit's own events
 * land there too), rate-limit rejections (rate-limit-history.ts) and idempotency claims (idempotency-history.ts) — the
 * last two recent only — background-job runs (job-history.ts) and people with their access (access-history.ts) into an
 * empty database. Same --seed → same records (only their own uuids and "now" differ). Refuses a database that
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

    console.log(`Raising ${days} days of demo domain events …`);
    const emitted = await new DomainEventHistory(app.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER, { strict: false }), new Rng(seed)).run({
      days, volume, until: new Date(),
    });
    // Write the recorder's buffer now rather than on its next tick, so the summary sees it.
    await app.get<PostgresEventDeliveryRecorder>(POSTGRES_EVENT_DELIVERY_RECORDER, { strict: false }).flush();
    const deliveries = await db.execute(sql`
      select status, count(*)::int as n from commons_domain_events_delivery group by 1 order by 2 desc`);
    console.log(`✓ ${emitted.emitted} demo events → deliveries (audit's included): ` +
      deliveries.rows.map((r) => `${r.status} ${r.n}`).join(', '));

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

    console.log(`Recording ${days} days of background-job runs, then running four jobs now …`);
    const jobs = await new JobHistory(app.get<JobRunRecorder>(POSTGRES_JOB_RUN_RECORDER, { strict: false }), db, new Rng(seed)).run(
      { days, until: new Date() }, baseUrl);
    const jobRuns = await db.execute(sql`
      select count(*)::int as n, count(*) filter (where outcome = 'job_failed')::int as job_failed,
             count(*) filter (where items_failed > 0)::int as with_failed_items, count(distinct job_name)::int as jobs
      from commons_jobs_job_run`);
    const j = jobRuns.rows[0];
    console.log(`✓ ${jobs.recorded} past runs + ${jobs.manual} run now → ${j.n} runs of ${j.jobs} jobs: ` +
      `${j.with_failed_items} with failed items, ${j.job_failed} job failures; one stale lock (statement-export)`);

    console.log('Creating people and their access — roles, delegations, the catalog, 30 days of denied requests …');
    const denialRecorder = app.get<PostgresAccessDenialRecorder>(POSTGRES_ACCESS_DENIAL_RECORDER, { strict: false });
    const access = await new AccessHistory(baseUrl, db, denialRecorder, new Rng(seed)).run(new Date());
    // Write the recorder's buffer now rather than on its next tick, so the summary sees it.
    await denialRecorder.flush();
    const roles = await db.execute(sql`
      select count(*)::int as n, count(*) filter (where expires_at <= now())::int as expired,
             count(*) filter (where expires_at > now())::int as expiring, count(distinct user_id)::int as users
      from commons_authz_user_role`);
    const lent = await db.execute(sql`
      select count(*) filter (where revoked_at is null and expires_at > now())::int as active,
             count(*) filter (where revoked_at is not null)::int as revoked,
             count(*) filter (where revoked_at is null and expires_at <= now())::int as expired
      from commons_authz_delegation`);
    const denied = await db.execute(sql`select count(*)::int as n, coalesce(sum(denial_count), 0)::int as total from commons_authz_denial`);
    const r = roles.rows[0], l = lent.rows[0], d = denied.rows[0];
    console.log(`✓ ${access.people} people; ${r.n} role assignments for ${r.users} users (${r.expiring} with an expiry, ${r.expired} expired); ` +
      `delegations ${l.active} active, ${l.revoked} revoked, ${l.expired} expired; ${d.total} denied requests in ${d.n} windows`);

    console.log(`Configuring notifications and recording ${days} days of deliveries, then sending a few now …`);
    const notified = await new NotificationHistory(
      baseUrl,
      db,
      app.get<PostgresNotificationDeliveryRecorder>(POSTGRES_NOTIFICATION_DELIVERY_RECORDER, { strict: false }),
      app.get(PostgresNotificationRetentionService, { strict: false }),
      app.get<Notifier>(NOTIFIER, { strict: false }),
      app.get<NotificationRecipientHasher>(NOTIFICATION_RECIPIENT_HASHER, { strict: false }),
      new Rng(seed),
    ).run({ days, until: new Date() });
    const sent = await db.execute(sql`
      select count(*)::int as n,
             count(*) filter (where status = 'delivered')::int as delivered, count(*) filter (where status = 'bounced')::int as bounced,
             count(*) filter (where status = 'failed')::int as failed, count(*) filter (where status = 'skipped')::int as skipped,
             count(*) filter (where is_test)::int as tests, count(*) filter (where content is not null)::int as with_content
      from commons_notification_delivery`);
    const side = await db.execute(sql`
      select (select count(*)::int from commons_notification_suppression) as suppressed,
             (select count(*)::int from commons_notification_inbox) as inbox,
             (select count(*)::int from commons_notification_dedupe) as dedupe,
             (select count(*)::int from commons_notification_preference) as prefs`);
    const n = sent.rows[0], x = side.rows[0];
    console.log(`✓ ${notified.recorded} past attempts + ${notified.liveSends} sent now, ${notified.callbacks} provider callbacks → ` +
      `${n.n} deliveries: ${n.delivered} delivered, ${n.bounced} bounced, ${n.failed} failed, ${n.skipped} skipped, ${n.tests} test sends ` +
      `(${n.with_content} still holding content); ${x.suppressed} suppressed, ${x.inbox} inbox items, ${x.dedupe} dedupe key, ${x.prefs} preference`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
