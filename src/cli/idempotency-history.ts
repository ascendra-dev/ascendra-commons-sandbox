import { CUSTOMERS, TENANTS, type CastTenant } from './cast';
import type { Rng } from './rng';

/**
 * Generates idempotency claims the only way the module makes them: real requests carrying an `Idempotency-Key` to
 * the idempotent demo endpoints (src/demo/idempotent-demo.controller.ts), signed in as each tenant's admin — so a
 * claim's scope is that tenant. Retries reuse the key (and the correlation id), exactly as a well-behaved client does.
 *
 * Recent only: a claim is stamped with the real clock, and the store keeps claims 24 hours anyway. `npm run simulate`
 * keeps adding payments as time passes.
 *
 * Two cases depend on the sandbox's `staleAfterSeconds` (5s, src/modules/commons/idempotency.ts) and take ~7s each,
 * run alongside everything else: a request taken over while still running (it ran twice), and one taken over after
 * its handler crashed (reclaimed, ran once).
 */

/** Each tenant's office address — its own rate-limit counter, so the run never meets the global ceiling. */
const OFFICE_IP: Record<string, string> = {
  tenant_acme: '198.51.100.10',
  tenant_globex: '198.51.100.11',
  tenant_meridian: '198.51.100.12',
};

/** Longer than the sandbox's staleAfterSeconds (5s): a retry after that may take the claim over. */
const PAST_STALE_MS = 6_000;

export interface IdempotencyTotals {
  requests: number;
  byStatus: Record<number, number>;
}

interface Call {
  path: string;
  body: unknown;
  key: string;
  correlationId: string;
  /** Sandbox-only: how long the demo "gateway" takes. */
  delayMs?: number;
}

export class IdempotencyHistory {
  private readonly totals: IdempotencyTotals = { requests: 0, byStatus: {} };
  private readonly tokens = new Map<string, string>();

  constructor(
    private readonly baseUrl: string,
    private readonly rng: Rng,
  ) {}

  async run(volume = 1): Promise<IdempotencyTotals> {
    await this.signIn();
    const scale = (n: number) => Math.max(1, Math.round(n * volume));

    // The two slow cases first, in the background — they wait out the stale window while the rest runs.
    const slow = Promise.all([this.takenOverWhileRunning(), this.takenOverAfterCrash()]);

    for (let i = 0; i < scale(200); i++) await this.payment();
    for (let i = 0; i < scale(90); i++) await this.invoiceSend();
    for (let i = 0; i < scale(60); i++) await this.refund();
    for (let i = 0; i < scale(37); i++) await this.payout();
    await this.stuckPayouts();
    for (let i = 0; i < 4; i++) await this.checkout();

    await slow;
    return this.totals;
  }

  /** A dev token per tenant admin (`POST /dev/token`) — the idempotent routes are signed-in staff only. */
  async signIn() {
    for (const t of TENANTS) {
      const res = await fetch(`${this.baseUrl}/dev/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: t.admin.id }),
      });
      if (!res.ok) throw new Error(`Dev sign-in as ${t.admin.id} failed (${res.status})`);
      this.tokens.set(t.id, ((await res.json()) as { token: string }).token);
    }
  }

  /** One request as `tenant` — its status code. */
  async send(tenant: CastTenant, call: Call): Promise<number> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.tokens.get(tenant.id)}`,
      'content-type': 'application/json',
      'idempotency-key': call.key,
      'x-correlation-id': call.correlationId,
      'x-forwarded-for': OFFICE_IP[tenant.id],
    };
    if (call.delayMs) headers['x-demo-delay-ms'] = String(call.delayMs);
    const res = await fetch(`${this.baseUrl}${call.path}`, { method: 'POST', headers, body: JSON.stringify(call.body) });
    await res.arrayBuffer();
    this.totals.requests += 1;
    this.totals.byStatus[res.status] = (this.totals.byStatus[res.status] ?? 0) + 1;
    return res.status;
  }

  /**
   * A customer pays. Now and then the client's network drops the answer and it retries — the same key, so the saved
   * response is replayed (1–3 times). Rarely the customer double-clicks: the second click lands while the first is
   * still at the gateway, and gets a 409.
   */
  async payment(tenant = this.rng.pick(TENANTS), correlationId = this.rng.uuid()): Promise<void> {
    const customer = this.rng.pick(CUSTOMERS);
    const call: Call = {
      path: '/demo/payments',
      key: this.rng.uuid(),
      correlationId,
      body: { amount: this.rng.int(50, 2_500) * 100, currency: tenant.currency, payer: party(customer.name) },
    };
    if (this.rng.chance(0.05)) {
      // The double-click: the first takes 400ms at the gateway, the second arrives 100ms in.
      await Promise.all([this.send(tenant, { ...call, delayMs: 400 }), later(100, () => this.send(tenant, call))]);
      return;
    }
    await this.send(tenant, call);
    if (this.rng.chance(0.12)) for (let r = this.rng.int(1, 3); r > 0; r--) await this.send(tenant, call);
  }

  /** Staff send an invoice to its customer; a flaky connection retries one in ten (a replay). */
  async invoiceSend(tenant = this.rng.pick(TENANTS), correlationId = this.rng.uuid()): Promise<void> {
    const call = this.invoiceCall(tenant, correlationId);
    await this.send(tenant, call);
    if (this.rng.chance(0.1)) await this.send(tenant, call);
  }

  /**
   * A refund. One in six asks for more than the payment captured — a 422 that is saved, so the retries staff make
   * (about half of them do) get the same 422 back: "my retry keeps failing".
   */
  async refund(): Promise<void> {
    const tenant = this.rng.pick(TENANTS);
    const captured = this.rng.int(50, 2_500) * 100;
    const tooMuch = this.rng.chance(1 / 6);
    const call: Call = {
      path: '/demo/refunds',
      key: this.rng.uuid(),
      correlationId: this.rng.uuid(),
      body: {
        paymentId: `pay_${this.rng.uuid().slice(0, 8)}`,
        amount: tooMuch ? captured + this.rng.int(1, 50) * 100 : Math.round(captured * this.rng.int(10, 100) / 100),
        captured,
        currency: tenant.currency,
      },
    };
    await this.send(tenant, call);
    if (tooMuch && this.rng.chance(0.5)) for (let r = this.rng.int(1, 2); r > 0; r--) await this.send(tenant, call);
  }

  /** A supplier payout that goes through. */
  async payout(): Promise<void> {
    const tenant = this.rng.pick(TENANTS);
    await this.send(tenant, this.payoutCall(tenant, false));
  }

  /**
   * Three payouts whose gateway times out — an unexpected error, so nothing is saved and each claim stays in progress
   * (the Overview's "In progress" list). One client retries at once and is turned away with a 409.
   */
  async stuckPayouts(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const tenant = this.rng.pick(TENANTS);
      const call = this.payoutCall(tenant, true);
      await this.send(tenant, call);
      if (i === 0) await this.send(tenant, { ...call, body: { ...(call.body as object), gatewayTimeout: false } });
    }
  }

  /** A checkout: the payment and the invoice it settles under one correlation id — a trace with two claims. */
  async checkout(): Promise<void> {
    const tenant = this.rng.pick(TENANTS);
    const correlationId = this.rng.uuid();
    await this.payment(tenant, correlationId);
    await this.invoiceSend(tenant, correlationId);
  }

  /**
   * Ran twice: an invoice send whose mail gateway takes 7s — past the 5s stale window. The client gives up at 6s and
   * retries with the same key; the claim is taken over and the send runs again. When the first finally finishes, its
   * result is discarded (a late complete). Two emails went out.
   */
  async takenOverWhileRunning(): Promise<void> {
    const tenant = TENANTS[2];
    const call = this.invoiceCall(tenant, this.rng.uuid());
    await Promise.all([this.send(tenant, { ...call, delayMs: 7_000 }), later(PAST_STALE_MS, () => this.send(tenant, call))]);
  }

  /**
   * Reclaimed, ran once: a payout whose gateway times out leaves its claim in progress; the client retries after the
   * stale window, takes the claim over and pays out. Only one payout ran — a reclaim isn't always a duplicate.
   */
  async takenOverAfterCrash(): Promise<void> {
    const tenant = TENANTS[0];
    const call = this.payoutCall(tenant, true);
    await this.send(tenant, call);
    await later(PAST_STALE_MS, () => this.send(tenant, { ...call, body: { ...(call.body as object), gatewayTimeout: false } }));
  }

  private invoiceCall(tenant: CastTenant, correlationId: string): Call {
    const customer = this.rng.pick(CUSTOMERS);
    return {
      path: `/demo/invoices/inv_${this.rng.uuid().slice(0, 8)}/send`,
      key: this.rng.uuid(),
      correlationId,
      body: { customer: party(customer.name), amount: this.rng.int(50, 2_500) * 100, currency: tenant.currency },
    };
  }

  private payoutCall(tenant: CastTenant, gatewayTimeout: boolean): Call {
    return {
      path: '/demo/payouts',
      key: this.rng.uuid(),
      correlationId: this.rng.uuid(),
      body: { supplier: party(this.rng.pick(CUSTOMERS).name), amount: this.rng.int(100, 5_000) * 100, currency: tenant.currency, gatewayTimeout },
    };
  }
}

/** A customer or supplier as the endpoints take one — the email is a reserved `.test` address. */
function party(name: string) {
  return { name, email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@example.test` };
}

function later<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => setTimeout(() => fn().then(resolve, reject), ms));
}
