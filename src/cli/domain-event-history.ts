import type { DomainEventEmitter } from '../ascendra-commons/domain-events/domain-events.core';
import {
  CustomerUpdated,
  DEMO_EVENTS,
  InvoiceIssued,
  InvoicePaid,
  PaymentCaptured,
  PayoutRequested,
} from '../demo/demo-events';
import { CUSTOMERS, TENANTS, type CastTenant } from './cast';
import type { Rng } from './rng';

/**
 * Generates domain-event deliveries the only way the module records them: real `emit()` / `emitCritical()` calls on
 * the app's own emitter, to the demo listeners in src/demo/demo-events.ts — each event at a past moment
 * (`occurredAt`), which is what every domain-events screen counts by. Each case is there on purpose (see that file's
 * table): normal deliveries, a critical event, a two-event checkout trace under one correlation id, a critical
 * listener raised with emit() that sometimes throws, an event nobody listens to.
 *
 * audit-history.ts's AuditRecordRaised deliveries land in the same log — without a correlation id: audit passes its id
 * through AsyncLocalStorage, never as emit()'s third argument.
 */

export interface DomainEventHistoryOptions {
  days: number;
  /** Multiplies how many invoices a day each tenant raises — 1 is "normal". */
  volume: number;
  /** History ends here (real now). An event that would land later isn't emitted. */
  until: Date;
}

export interface DomainEventTotals {
  emitted: number;
  byEvent: Record<string, number>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export class DomainEventHistory {
  private readonly totals: DomainEventTotals = { emitted: 0, byEvent: {} };

  constructor(
    private readonly events: DomainEventEmitter,
    private readonly rng: Rng,
  ) {}

  async run(options: DomainEventHistoryOptions): Promise<DomainEventTotals> {
    // Real UTC calendar days ending today — counted back from "now" instead, the last day would end at this hour and
    // today's working hours would hold no events, leaving the newest deliveries all audit's.
    const today = new Date(options.until);
    const todayMidnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    for (let day = 0; day < options.days; day++) {
      const midnight = todayMidnight - (options.days - 1 - day) * DAY;
      const weekend = [0, 6].includes(new Date(midnight).getUTCDay());
      for (const tenant of TENANTS) {
        const invoices = Math.round(tenant.dailyInvoices * options.volume * (weekend ? 0.3 : 1) * (0.6 + this.rng.next() * 0.8));
        for (let i = 0; i < invoices; i++) await this.invoice(tenant, this.workingHour(midnight), options.until);
        // A customer's details change now and then — nothing subscribes to customer.updated.
        if (this.rng.chance(0.6)) await this.customerUpdated(tenant, this.workingHour(midnight), options.until);
        // Every few days a payout — raised with emit(), though Treasury's listener is critical.
        if (this.rng.chance(0.3)) await this.payout(tenant, this.workingHour(midnight), options.until);
      }
    }
    return this.totals;
  }

  /** One invoice issued; most are paid later — a checkout: payment.captured, then invoice.paid, under one correlation id. */
  async invoice(tenant: CastTenant, at: Date, until: Date): Promise<void> {
    const invoiceId = this.rng.uuid();
    const amount = this.rng.int(50, 2_500) * 100;
    await this.emit(until, at, 'emit', DEMO_EVENTS.INVOICE_ISSUED, new InvoiceIssued(tenant.id, invoiceId, amount, tenant.currency, at));
    if (!this.rng.chance(0.7)) return;

    const paidAt = new Date(at.getTime() + this.rng.int(10, 72 * 60) * MINUTE);
    const checkout = this.rng.uuid();
    const paymentId = `pay_${this.rng.uuid().slice(0, 8)}`;
    await this.emit(until, paidAt, 'emitCritical', DEMO_EVENTS.PAYMENT_CAPTURED,
      new PaymentCaptured(tenant.id, invoiceId, paymentId, amount, tenant.currency, paidAt), checkout);
    const settledAt = new Date(paidAt.getTime() + this.rng.int(50, 900));
    await this.emit(until, settledAt, 'emit', DEMO_EVENTS.INVOICE_PAID, new InvoicePaid(tenant.id, invoiceId, settledAt), checkout);
  }

  async customerUpdated(tenant: CastTenant, at: Date, until: Date): Promise<void> {
    const fields = this.rng.chance(0.5) ? ['billingAddress'] : ['email', 'phone'];
    const customer = this.rng.pick(CUSTOMERS);
    await this.emit(until, at, 'emit', DEMO_EVENTS.CUSTOMER_UPDATED,
      new CustomerUpdated(tenant.id, `cus_${customer.name.toLowerCase().replace(/\W+/g, '_')}`, fields, at));
  }

  /** One in six is over the daily limit — Treasury throws, and because it's emit(), nobody hears about it. */
  async payout(tenant: CastTenant, at: Date, until: Date): Promise<void> {
    const amount = this.rng.int(500, 20_000) * 100;
    await this.emit(until, at, 'emit', DEMO_EVENTS.PAYOUT_REQUESTED,
      new PayoutRequested(tenant.id, `po_${this.rng.uuid().slice(0, 8)}`, amount, tenant.currency, this.rng.chance(1 / 6), at),
      this.rng.uuid());
  }

  /** 08:00–18:00 UTC on the given day. */
  private workingHour(midnight: number): Date {
    return new Date(midnight + this.rng.int(8 * 60, 18 * 60) * MINUTE + this.rng.int(0, 59_999));
  }

  private async emit(
    until: Date,
    at: Date,
    method: 'emit' | 'emitCritical',
    name: string,
    event: InvoiceIssued | PaymentCaptured | InvoicePaid | PayoutRequested | CustomerUpdated,
    correlationId: string = this.rng.uuid(),
  ): Promise<void> {
    if (at > until) return;
    if (method === 'emitCritical') await this.events.emitCritical(name, event, correlationId);
    else this.events.emit(name, event, correlationId);
    this.totals.emitted += 1;
    this.totals.byEvent[name] = (this.totals.byEvent[name] ?? 0) + 1;
  }
}
