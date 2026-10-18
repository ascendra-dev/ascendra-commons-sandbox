import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DOMAIN_EVENT_EMITTER, type DomainEventEmitter } from '../ascendra-commons/domain-events/domain-events.core';
import { AuditModule } from '../audit/audit.module';
import { parseArgs } from './args';
import { AuditHistory } from './audit-history';
import { CUSTOMERS, FAILURE_REASONS, PAYMENT_GATEWAY, PAYMENT_METHODS, SERVICES, TENANTS } from './cast';
import { Rng } from './rng';

/**
 *   npm run simulate -- [--every 5] [--count 0]
 *
 * Keeps the history live: every N seconds one change happens now — an invoice raised and issued, one of those paid
 * (or its payment failing), or a profile edit. --count stops after that many (0 = until Ctrl+C).
 */
async function main() {
  const args = parseArgs(process.argv.slice(2), { every: 'number', count: 'number' });
  const every = (args.every as number | undefined) ?? 5;
  const count = (args.count as number | undefined) ?? 0;
  if (every < 1) throw new Error('--every must be at least 1 (seconds)');

  const app = await NestFactory.createApplicationContext(AuditModule, { logger: ['error', 'warn'] });
  const rng = new Rng(Date.now());
  const events = app.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER, { strict: false });
  // Invoices issued during this run, so a later tick can pay one.
  const open: { id: string; tenantId: string; currency: string; amount: number; status: 'issued' | 'payment_failed' }[] = [];

  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });

  const tick = async (): Promise<string> => {
    const history = new AuditHistory(events, rng, new Date(Date.now() + 1000));
    const now = new Date();
    const t = rng.pick(TENANTS);
    const roll = rng.next();

    if (roll < 0.5 || open.length === 0) {
      const author = rng.pick(t.staff).id;
      const id = rng.uuid();
      const customer = rng.pick(CUSTOMERS);
      const amount = rng.int(50, 2_500) * 100;
      const request = history.corr();
      // Staff raises an invoice …
      await history.emit(now, request, author, { entityType: 'invoice', entityId: id, tenantId: t.id, action: 'created', before: null,
        after: { status: 'draft', customerName: customer.name, billingAddress: customer.address,
                 lineItems: [{ description: rng.pick(SERVICES), amount }], amount, currency: t.currency } });
      // … and issues it straight away (same request).
      await history.emit(now, request, author, { entityType: 'invoice', entityId: id, tenantId: t.id, action: 'issued',
        before: { status: 'draft' }, after: { status: 'issued', dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) } });
      open.push({ id, tenantId: t.id, currency: t.currency, amount, status: 'issued' });
      return `${t.name}: invoice raised and issued`;
    }

    if (roll < 0.9) {
      const inv = open.splice(rng.int(0, open.length - 1), 1)[0];
      const name = TENANTS.find((x) => x.id === inv.tenantId)!.name;
      const captured = rng.chance(0.8);
      const reason = captured ? undefined : rng.pick(FAILURE_REASONS);
      const request = history.corr();
      // The gateway charges the payment …
      await history.emit(now, request, PAYMENT_GATEWAY, { entityType: 'payment', entityId: rng.uuid(), tenantId: inv.tenantId,
        action: captured ? 'captured' : 'failed', before: null,
        after: { invoiceId: inv.id, amount: inv.amount, currency: inv.currency, method: rng.pick(PAYMENT_METHODS), status: captured ? 'captured' : 'failed' }, reason });
      // … and the invoice follows (same request).
      await history.emit(now, request, PAYMENT_GATEWAY, { entityType: 'invoice', entityId: inv.id, tenantId: inv.tenantId,
        action: captured ? 'paid' : 'payment_failed', before: { status: inv.status }, after: { status: captured ? 'paid' : 'payment_failed' }, reason });
      if (!captured) open.push({ ...inv, status: 'payment_failed' });
      return `${name}: ${captured ? 'invoice paid' : 'payment failed'}`;
    }

    const person = rng.pick(t.staff);
    // Someone edits their phone number.
    await history.emit(now, history.corr(), person.id, { entityType: 'user', entityId: person.id, tenantId: t.id, action: 'profile_updated',
      before: { phone: null }, after: { phone: `+92 3${rng.int(0, 4)}${rng.int(0, 9)} ${rng.int(1000000, 9999999)}` } });
    return `${t.name}: ${person.name} updated their profile`;
  };

  console.log(`Simulating a change every ${every}s${count ? `, ${count} times` : ' — Ctrl+C to stop'} …`);
  try {
    for (let n = 1; !stopping && (!count || n <= count); n++) {
      console.log(`  ${new Date().toISOString().slice(11, 19)}  ${await tick()}`);
      if (!count || n < count) await new Promise((resolve) => setTimeout(resolve, every * 1000));
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
