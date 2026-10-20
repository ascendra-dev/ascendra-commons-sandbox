import { AUDIT_EVENT_NAME, AuditRecordRaised, runWithCorrelationId } from '../ascendra-commons/audit-logging/audit-logging.core';
import type { DomainEventEmitter } from '../ascendra-commons/domain-events/domain-events.core';
import {
  CUSTOMERS, FAILURE_REASONS, PAYMENT_GATEWAY, PAYMENT_METHODS, PLATFORM_ADMIN, REFUND_REASONS, ROUTE_EVENTS, SERVICES,
  STREETS, TENANTS, VOID_REASONS, type CastTenant,
} from './cast';
import type { Rng } from './rng';

/**
 * Generates a realistic audit history as a sequence of audit events. Each `emit` raises an `AuditRecordRaised` through
 * ascendra-commons — its AuditListener and Postgres repository do the insert — at a past moment, under a correlation id.
 * There's no product behind it: each event carries just what that change touched, and a local variable only where two
 * events must agree (an invoice's id, the street an edit changes, the correlation id a payment and its invoice share).
 */

interface AuditEvent {
  entityType: string;
  entityId: string;
  tenantId: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason?: string;
}

export interface HistoryOptions {
  days: number;
  /** Multiplies how many invoices a day each tenant raises — 1 is "normal". */
  volume: number;
  /** History ends here (real now). An event that would land later isn't emitted, and its scenario stops. */
  until: Date;
  onDay?: (day: number, days: number) => void;
}

const total = (items: { amount: number }[]) => items.reduce((sum, item) => sum + item.amount, 0);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Platform-level changes (no tenant on the record): two tenants move up a plan during the history. */
const PLAN_UPGRADES = [
  { day: 20, tenantId: 'tenant_globex', from: 'starter', to: 'growth' },
  { day: 50, tenantId: 'tenant_acme', from: 'growth', to: 'enterprise' },
];

export class AuditHistory {
  constructor(
    private readonly events: DomainEventEmitter,
    private readonly rng: Rng,
    private readonly until: Date = new Date(),
  ) {}

  /** Raises one audit event at `at` — false (nothing emitted) when `at` is after the history's end. */
  async emit(at: Date, correlationId: string, actor: string, e: AuditEvent): Promise<boolean> {
    if (at > this.until) return false;
    await runWithCorrelationId(correlationId, () =>
      this.events.emitCritical(AUDIT_EVENT_NAME, new AuditRecordRaised({
        entityType: e.entityType,
        entityId: e.entityId,
        tenantId: e.tenantId,
        actor,
        action: e.action,
        before: e.before,
        after: e.after,
        occurredAt: at,
        reason: e.reason,
      })));
    return true;
  }

  /** A new correlation id — one per "request". Events that share one show up together as a trace. */
  corr(): string {
    return this.rng.uuid();
  }

  async run(opts: HistoryOptions) {
    const start = new Date(this.until.getTime() - opts.days * DAY);
    await this.onboarding(start);
    await this.disputedDraft(TENANTS[0], new Date(start.getTime() + 5 * DAY), Math.min(60, Math.max(0, opts.days - 15)));

    for (let day = 1; day <= opts.days; day++) {
      const dayStart = new Date(start.getTime() + day * DAY);
      dayStart.setUTCHours(0, 0, 0, 0);
      const weekend = [0, 6].includes(dayStart.getUTCDay());
      for (const tenant of TENANTS) {
        const target = tenant.dailyInvoices * opts.volume * (weekend ? 0.25 : 1);
        const count = Math.round(target * (0.6 + this.rng.next() * 0.8));
        for (let i = 0; i < count; i++) await this.invoiceLifecycle(tenant, this.workingMoment(dayStart));
        await this.occasionalChanges(tenant, dayStart, day);
      }
      opts.onDay?.(day, opts.days);
    }
  }

  // ─── Day 0: onboarding ──────────────────────────────────────────────────────────────────────────────────────────

  /** The platform admin creates each tenant and invites its admin; the admin invites staff and sets up notifications. */
  private async onboarding(start: Date) {
    let at = start.getTime();
    const next = (minutes: number) => new Date((at += minutes * MINUTE));
    for (const t of TENANTS) {
      // Platform admin creates the tenant — a platform-level record (no tenant).
      await this.emit(next(30), this.corr(), PLATFORM_ADMIN, {
        entityType: 'tenant', entityId: t.id, tenantId: null, action: 'created',
        before: null, after: { name: t.name, plan: t.plan } });

      // Platform admin invites the tenant's admin.
      await this.emit(next(5), this.corr(), PLATFORM_ADMIN, {
        entityType: 'user', entityId: t.admin.id, tenantId: t.id, action: 'invited',
        before: null, after: { name: t.admin.name, roles: ['admin'] } });

      for (const person of t.staff) {
        // The tenant admin invites each member of staff.
        await this.emit(next(20), this.corr(), t.admin.id, {
          entityType: 'user', entityId: person.id, tenantId: t.id, action: 'invited',
          before: null, after: { name: person.name, title: person.title, roles: ['billing'] } });
      }

      for (const event of ROUTE_EVENTS) {
        // The tenant admin routes each notification to the finance mailbox.
        await this.emit(next(3), this.corr(), t.admin.id, {
          entityType: 'channel_route', entityId: this.rng.uuid(), tenantId: t.id, action: 'route_set',
          before: null, after: { event, channel: 'email', target: `finance@${t.id.slice(7)}.test` } });
      }
    }
  }

  // ─── Invoices ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** One invoice: created, maybe revised, issued, then paid / failed and retried / voided / refunded / left open. */
  private async invoiceLifecycle(t: CastTenant, createdAt: Date) {
    const rng = this.rng;
    const author = rng.pick(t.staff).id;
    const customer = rng.pick(CUSTOMERS);
    const lineItems = this.lineItems();
    const amount = total(lineItems);
    const invoice = { entityType: 'invoice', entityId: rng.uuid(), tenantId: t.id };
    let at = createdAt.getTime();
    const later = (min: number, max: number) => new Date((at += rng.int(min, max)));

    // Staff creates a draft.
    if (!(await this.emit(createdAt, this.corr(), author, { ...invoice, action: 'created', before: null,
      after: { number: this.nextNumber(t), status: 'draft', customerName: customer.name, billingAddress: customer.address,
               lineItems, amount, currency: t.currency } }))) return;

    // Sometimes the draft is revised: a new billing street (a nested diff) or new line items (a list diff).
    if (rng.chance(0.35)) {
      const newItems = this.lineItems();
      const revision = rng.chance(0.5)
        ? { before: { billingAddress: customer.address }, after: { billingAddress: { ...customer.address, street: rng.pick(STREETS) } } }
        : { before: { lineItems, amount }, after: { lineItems: newItems, amount: total(newItems) } };
      if (!(await this.emit(later(5 * MINUTE, 10 * HOUR), this.corr(), author, { ...invoice, action: 'updated', ...revision }))) return;
    }

    // A few drafts are voided before they're ever sent.
    if (rng.chance(0.04)) {
      await this.emit(later(HOUR, 2 * DAY), this.corr(), t.admin.id, { ...invoice, action: 'voided',
        before: { status: 'draft' }, after: { status: 'void' }, reason: rng.pick(VOID_REASONS) });
      return;
    }

    // Issued — sometimes with the signed order attached in the same request (one correlation id, two entities).
    const issuedAt = later(HOUR, 2 * DAY);
    const issueRequest = this.corr();
    const dueDate = new Date(issuedAt.getTime() + rng.pick([14, 30]) * DAY).toISOString().slice(0, 10);
    if (rng.chance(0.3)) {
      await this.emit(issuedAt, issueRequest, author, { entityType: 'attachment', entityId: rng.uuid(), tenantId: t.id,
        action: 'uploaded', before: null,
        after: { invoiceId: invoice.entityId, filename: rng.pick(['signed-order.pdf', 'purchase-order.pdf', 'timesheet.xlsx']),
                 sizeBytes: rng.int(40_000, 4_000_000) } });
    }
    if (!(await this.emit(issuedAt, issueRequest, author, { ...invoice, action: 'issued',
      before: { status: 'draft' }, after: { status: 'issued', dueDate } }))) return;

    const outcome = rng.next();
    // Some issued invoices are voided (the admin, with a reason)…
    if (outcome < 0.06) {
      await this.emit(later(DAY, 10 * DAY), this.corr(), t.admin.id, { ...invoice, action: 'voided',
        before: { status: 'issued' }, after: { status: 'void' }, reason: rng.pick(VOID_REASONS) });
      return;
    }
    // …and some are still outstanding.
    if (outcome < 0.18) return;

    const method = rng.pick(PAYMENT_METHODS);
    let status = 'issued';
    if (rng.chance(0.2)) {
      // The gateway's first charge fails.
      if (!(await this.payment(later(DAY, 10 * DAY), t, invoice.entityId, status, 'failed', amount, method, rng.pick(FAILURE_REASONS)))) return;
      status = 'payment_failed';
      // A few are written off after the failure.
      if (rng.chance(0.15)) {
        await this.emit(later(3 * DAY, 15 * DAY), this.corr(), t.admin.id, { ...invoice, action: 'voided',
          before: { status }, after: { status: 'void' }, reason: 'Written off after repeated payment failures' });
        return;
      }
    }
    // The gateway captures the payment.
    const paymentId = await this.payment(later(DAY, 18 * DAY), t, invoice.entityId, status, 'captured', amount, method);
    if (!paymentId) return;

    // Now and then the admin refunds it.
    if (rng.chance(0.04)) {
      await this.emit(later(2 * DAY, 20 * DAY), this.corr(), t.admin.id, { entityType: 'payment', entityId: paymentId, tenantId: t.id,
        action: 'refunded', before: { status: 'captured' }, after: { status: 'refunded' }, reason: rng.pick(REFUND_REASONS) });
    }
  }

  /**
   * A gateway charge: the payment and its invoice change in one request, so both records share a correlation id.
   * Returns the payment id, or null when it would be in the future.
   */
  private async payment(at: Date, t: CastTenant, invoiceId: string, invoiceStatus: string, result: 'captured' | 'failed',
                        amount: number, method: string, reason?: string): Promise<string | null> {
    const request = this.corr();
    const paymentId = this.rng.uuid();
    // The payment itself.
    if (!(await this.emit(at, request, PAYMENT_GATEWAY, { entityType: 'payment', entityId: paymentId, tenantId: t.id,
      action: result, before: null, after: { invoiceId, amount, currency: t.currency, method, status: result }, reason }))) return null;
    // Its invoice: paid, or marked payment-failed.
    await this.emit(at, request, PAYMENT_GATEWAY, { entityType: 'invoice', entityId: invoiceId, tenantId: t.id,
      action: result === 'captured' ? 'paid' : 'payment_failed',
      before: { status: invoiceStatus }, after: { status: result === 'captured' ? 'paid' : 'payment_failed' }, reason });
    return paymentId;
  }

  /**
   * A draft revised again and again for weeks (a disputed quote), then issued — more than 50 records on one entity,
   * so the Entity history sheet has to load older events.
   */
  private async disputedDraft(t: CastTenant, createdAt: Date, revisions: number) {
    const invoice = { entityType: 'invoice', entityId: this.rng.uuid(), tenantId: t.id };
    const customer = CUSTOMERS[0];
    let street = customer.address.street;
    let at = createdAt.getTime();

    // Created as a draft.
    if (!(await this.emit(createdAt, this.corr(), t.staff[0].id, { ...invoice, action: 'created', before: null,
      after: { number: this.nextNumber(t), status: 'draft', customerName: customer.name, billingAddress: customer.address,
               lineItems: this.lineItems(), currency: t.currency } }))) return;

    for (let i = 1; i <= revisions; i++) {
      // Revision i: the customer asks for another billing address.
      const newStreet = this.rng.pick(STREETS.filter((s) => s !== street));
      if (!(await this.emit(new Date((at += this.rng.int(10 * HOUR, 30 * HOUR))), this.corr(), this.rng.pick(t.staff).id, {
        ...invoice, action: 'updated', before: { billingAddress: { street } }, after: { billingAddress: { street: newStreet } },
        reason: `Revision ${i} requested by the customer` }))) return;
      street = newStreet;
    }

    // Finally agreed and issued.
    await this.emit(new Date(at + 2 * HOUR), this.corr(), t.staff[0].id, { ...invoice, action: 'issued',
      before: { status: 'draft' }, after: { status: 'issued', dueDate: new Date(at + 30 * DAY).toISOString().slice(0, 10) } });
  }

  // ─── Everything else ────────────────────────────────────────────────────────────────────────────────────────────

  /** The occasional change that isn't an invoice: profiles, roles, notification routes, a plan upgrade. */
  private async occasionalChanges(t: CastTenant, dayStart: Date, day: number) {
    const rng = this.rng;

    // Someone edits their own profile.
    if (rng.chance(0.05)) {
      const person = rng.pick(t.staff);
      const change = rng.chance(0.5)
        ? { before: { phone: null }, after: { phone: `+92 3${rng.int(0, 4)}${rng.int(0, 9)} ${rng.int(1000000, 9999999)}` } }
        : { before: { title: person.title }, after: { title: rng.pick(['Senior billing specialist', 'Team lead — receivables']) } };
      await this.emit(this.workingMoment(dayStart), this.corr(), person.id, {
        entityType: 'user', entityId: person.id, tenantId: t.id, action: 'profile_updated', ...change });
    }

    // The admin grants or revokes the approver role while someone covers for the finance lead.
    if (rng.chance(0.015)) {
      const person = rng.pick(t.staff);
      const grant = rng.chance(0.6);
      await this.emit(this.workingMoment(dayStart), this.corr(), t.admin.id, {
        entityType: 'user', entityId: person.id, tenantId: t.id, action: grant ? 'role_granted' : 'role_revoked',
        before: { roles: grant ? ['billing'] : ['billing', 'approver'] }, after: { roles: grant ? ['billing', 'approver'] : ['billing'] },
        reason: grant ? 'Covering approvals while the finance lead is on leave' : 'Cover period ended' });
    }

    // The admin re-routes one notification.
    if (rng.chance(0.02)) {
      await this.emit(this.workingMoment(dayStart), this.corr(), t.admin.id, {
        entityType: 'channel_route', entityId: rng.uuid(), tenantId: t.id, action: 'route_set',
        before: { channel: 'email' }, after: { event: rng.pick(ROUTE_EVENTS), channel: rng.pick(['slack', 'sms']), target: rng.pick(['#billing-alerts', '+44 7700 900123']) } });
    }

    // On set days the platform admin upgrades a tenant's plan — a platform-level record.
    const upgrade = PLAN_UPGRADES.find((u) => u.day === day && u.tenantId === t.id);
    if (upgrade) {
      await this.emit(this.workingMoment(dayStart), this.corr(), PLATFORM_ADMIN, {
        entityType: 'tenant', entityId: t.id, tenantId: null, action: 'plan_changed',
        before: { plan: upgrade.from }, after: { plan: upgrade.to }, reason: 'Upgraded at renewal' });
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────────────────────────────────────────

  private readonly invoiceNumbers = new Map<string, number>();

  private nextNumber(t: CastTenant): string {
    const n = (this.invoiceNumbers.get(t.id) ?? 0) + 1;
    this.invoiceNumbers.set(t.id, n);
    return `${t.id.slice(7, 10).toUpperCase()}-${String(n).padStart(5, '0')}`;
  }

  private lineItems() {
    return Array.from({ length: this.rng.int(1, 4) }, () => ({
      description: this.rng.pick(SERVICES),
      amount: this.rng.int(50, 2_500) * 100,
    }));
  }

  /** Somewhere in the working day (08:00–18:59 UTC). */
  private workingMoment(dayStart: Date): Date {
    return new Date(dayStart.getTime() + this.rng.int(8, 18) * HOUR + this.rng.int(0, 59) * MINUTE + this.rng.int(0, 59) * 1000);
  }
}
