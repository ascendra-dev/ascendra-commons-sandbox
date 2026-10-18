import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { DOMAIN_EVENT_EMITTER, type DomainEventEmitter } from '../ascendra-commons/domain-events/domain-events.core';
import { AuditModule } from '../audit/audit.module';
import { DATABASE_CONNECTION, type Database } from '../db/database.module';
import { parseArgs } from './args';
import { AuditHistory } from './audit-history';
import { Rng } from './rng';

const VOLUMES: Record<string, number> = { small: 0.3, normal: 1, large: 25 };

/**
 *   npm run seed -- [--days 90] [--seed 42] [--volume small|normal|large]
 *
 * Generates audit history into an empty database (see audit-history.ts). Same --seed → same records (only their own
 * uuids and "now" differ). Refuses a database that already has audit records — run db:reset.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2), { days: 'number', seed: 'number', volume: 'string' });
  const days = (args.days as number | undefined) ?? 90;
  const seed = (args.seed as number | undefined) ?? 42;
  const volumeName = (args.volume as string | undefined) ?? 'normal';
  const volume = VOLUMES[volumeName];
  if (!volume) throw new Error(`--volume must be one of ${Object.keys(VOLUMES).join(', ')}`);
  if (days < 1 || days > 400) throw new Error('--days must be between 1 and 400');

  // Just the audit wiring — the same modules the API runs, without HTTP.
  const app = await NestFactory.createApplicationContext(AuditModule, { logger: ['error', 'warn'] });
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
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
