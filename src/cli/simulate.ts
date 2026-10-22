import 'reflect-metadata';
import { DOMAIN_EVENT_EMITTER, type DomainEventEmitter } from '../ascendra-commons/domain-events/domain-events.core';
import { parseArgs } from './args';
import { AuditHistory } from './audit-history';
import { DomainEventHistory } from './domain-event-history';
import { IdempotencyHistory } from './idempotency-history';
import { CUSTOMERS, FAILURE_REASONS, PAYMENT_GATEWAY, PAYMENT_METHODS, SERVICES, TENANTS } from './cast';
import { startHttpApp } from './http-app';
import { RateLimitHistory } from './rate-limit-history';
import { Rng } from './rng';

/**
 *   npm run simulate -- [--every 5] [--count 0]
 *
 * Keeps the history live: every N seconds one change happens now — an invoice raised and issued, one of those paid
 * (or its payment failing), a profile edit, now and then a burst against a throttled endpoint (rate-limiting), or a
 * payment through an idempotent endpoint — sometimes retried or double-clicked (idempotency-key), or a demo domain event
 * (an invoice and its checkout, a payout, a customer edit — domain-events), or an admin's Run now (background-jobs —
 * the jobs' own schedules also fire in this process; the lease lock lets one copy run each). --count stops after
 * that many (0 = until Ctrl+C).
 */
async function main() {
  const args = parseArgs(process.argv.slice(2), { every: 'number', count: 'number' });
  const every = (args.every as number | undefined) ?? 5;
  const count = (args.count as number | undefined) ?? 0;
  if (every < 1) throw new Error('--every must be at least 1 (seconds)');

  // The whole API on a local port — rate-limit bursts go through HTTP, the only way its guard records them.
  const { app, baseUrl } = await startHttpApp();
  const rng = new Rng(Date.now());
  const limits = new RateLimitHistory(baseUrl, rng);
  const claims = new IdempotencyHistory(baseUrl, rng);
  await claims.signIn();
  const adminToken = ((await (await fetch(`${baseUrl}/dev/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actorId: 'platform.admin@ascendra.test' }),
  })).json()) as { token: string }).token;
  const events = app.get<DomainEventEmitter>(DOMAIN_EVENT_EMITTER, { strict: false });
  const demoEvents = new DomainEventHistory(events, rng);
  // Invoices issued during this run, so a later tick can pay one.
  const open: { id: string; tenantId: string; currency: string; amount: number; status: 'issued' | 'payment_failed' }[] = [];

  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });

  const tick = async (): Promise<string> => {
    const history = new AuditHistory(events, rng, new Date(Date.now() + 1000));
    const now = new Date();
    const t = rng.pick(TENANTS);
    const roll = rng.next();

    if (roll < 0.1) {
      // A short burst from a random address — over the limit, so part of it is turned away (and recorded).
      const ip = `203.0.113.${rng.int(1, 254)}`;
      if (rng.chance(0.3)) {
        const correlationId = await limits.syncJob(`100.64.1.${rng.int(1, 254)}`);
        return `rate-limit: a partner sync job was throttled (trace ${correlationId.slice(0, 8)}…)`;
      }
      if (rng.chance(0.5)) {
        await limits.enumeration(ip, rng.int(25, 60));
        return `rate-limit: ${ip} tried payment-link tokens`;
      }
      await limits.bruteForce(ip, rng.int(8, 20));
      return `rate-limit: ${ip} hammered sign-in`;
    }

    if (roll < 0.2) {
      // A customer pays through an idempotent endpoint — the client may retry or double-click (replays, 409s).
      await claims.payment();
      return 'idempotency: a payment (maybe retried)';
    }

    if (roll < 0.33 && roll >= 0.3) {
      // An admin runs a job now — through the API, so it's audited and traceable.
      const name = rng.pick(['invoice-reminders', 'webhook-retry', 'payout-sweep']);
      const res = await fetch(`${baseUrl}/jobs/${name}/run`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } });
      return `background-jobs: Run now on ${name} (${res.status})`;
    }

    if (roll < 0.3) {
      // A demo domain event, now: usually an invoice (often paid — a two-event checkout), else a payout or a customer edit.
      const until = new Date(Date.now() + 2 * 60 * 60 * 1000); // a checkout can land up to the following days; keep only "now"-ish
      const kind = rng.next();
      if (kind < 0.6) {
        await demoEvents.invoice(t, now, until);
        return `domain-events: ${t.name} issued an invoice`;
      }
      if (kind < 0.8) {
        await demoEvents.payout(t, now, until);
        return `domain-events: ${t.name} requested a payout`;
      }
      await demoEvents.customerUpdated(t, now, until);
      return `domain-events: ${t.name} updated a customer (nobody listens)`;
    }

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
