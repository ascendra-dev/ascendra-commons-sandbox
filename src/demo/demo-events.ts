import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OnCriticalEvent, type DomainEvent } from '../ascendra-commons/domain-events/domain-events.core';

/**
 * Sandbox-only domain events and listeners — the shapes domain-events' screens exist to show, each on purpose. There's
 * no product behind them: a listener only logs at debug, or throws where the case calls for it. Raised by
 * src/cli/domain-event-history.ts (seed, backdated) and src/cli/simulate.ts (live).
 *
 * | Event              | Raised with    | Listeners                                   | Shows                                    |
 * |--------------------|----------------|---------------------------------------------|------------------------------------------|
 * | invoice.issued     | emit()         | InvoiceMailer, CustomerPortal               | the normal case — two plain listeners    |
 * | payment.captured   | emitCritical() | Ledger (critical), ReceiptMailer            | a critical event, correctly raised       |
 * | invoice.paid       | emit()         | CustomerPortal                              | the second step of a checkout trace      |
 * | payout.requested   | emit() — wrong | Treasury (critical)                         | the mismatch: a critical listener's      |
 * |                    |                |                                             | failure swallowed; it sometimes throws   |
 * | customer.updated   | emit()         | none                                        | firing into nothing — a wiring gap       |
 * | refund.issued      | never raised   | Ledger                                      | a listener whose event never fires       |
 */

export const DEMO_EVENTS = {
  INVOICE_ISSUED: 'invoice.issued',
  PAYMENT_CAPTURED: 'payment.captured',
  INVOICE_PAID: 'invoice.paid',
  PAYOUT_REQUESTED: 'payout.requested',
  CUSTOMER_UPDATED: 'customer.updated',
  REFUND_ISSUED: 'refund.issued',
} as const;

export class InvoiceIssued implements DomainEvent {
  constructor(
    readonly tenantId: string,
    readonly invoiceId: string,
    readonly amount: number,
    readonly currency: string,
    readonly occurredAt: Date,
  ) {}
}

export class PaymentCaptured implements DomainEvent {
  constructor(
    readonly tenantId: string,
    readonly invoiceId: string,
    readonly paymentId: string,
    readonly amount: number,
    readonly currency: string,
    readonly occurredAt: Date,
  ) {}
}

export class InvoicePaid implements DomainEvent {
  constructor(
    readonly tenantId: string,
    readonly invoiceId: string,
    readonly occurredAt: Date,
  ) {}
}

export class PayoutRequested implements DomainEvent {
  constructor(
    readonly tenantId: string,
    readonly payoutId: string,
    readonly amount: number,
    readonly currency: string,
    /** Over the tenant's daily payout limit — Treasury rejects it. */
    readonly overLimit: boolean,
    readonly occurredAt: Date,
  ) {}
}

export class CustomerUpdated implements DomainEvent {
  constructor(
    readonly tenantId: string,
    readonly customerId: string,
    readonly fields: string[],
    readonly occurredAt: Date,
  ) {}
}

@Injectable()
export class InvoiceMailer {
  private readonly logger = new Logger(InvoiceMailer.name);

  @OnEvent(DEMO_EVENTS.INVOICE_ISSUED)
  sendInvoice(event: InvoiceIssued) {
    this.logger.debug(`would email invoice ${event.invoiceId}`);
  }
}

@Injectable()
export class CustomerPortal {
  private readonly logger = new Logger(CustomerPortal.name);

  @OnEvent(DEMO_EVENTS.INVOICE_ISSUED)
  publishInvoice(event: InvoiceIssued) {
    this.logger.debug(`would publish invoice ${event.invoiceId} to the portal`);
  }

  @OnEvent(DEMO_EVENTS.INVOICE_PAID)
  markPaid(event: InvoicePaid) {
    this.logger.debug(`would mark invoice ${event.invoiceId} paid in the portal`);
  }
}

@Injectable()
export class Ledger {
  private readonly logger = new Logger(Ledger.name);

  /** Critical: a payment the ledger didn't post must fail the capture. Raised with emitCritical() — correct. */
  @OnCriticalEvent(DEMO_EVENTS.PAYMENT_CAPTURED)
  postPayment(event: PaymentCaptured) {
    this.logger.debug(`would post payment ${event.paymentId}`);
  }

  /** Wired, but nothing ever raises `refund.issued` — the producer was never built (or misspells the name). */
  @OnCriticalEvent(DEMO_EVENTS.REFUND_ISSUED)
  postRefund() {
    this.logger.debug('would post a refund');
  }
}

@Injectable()
export class ReceiptMailer {
  private readonly logger = new Logger(ReceiptMailer.name);

  @OnEvent(DEMO_EVENTS.PAYMENT_CAPTURED)
  sendReceipt(event: PaymentCaptured) {
    this.logger.debug(`would email a receipt for ${event.paymentId}`);
  }
}

@Injectable()
export class Treasury {
  /**
   * Critical — a payout Treasury rejects must not go out. But its producer raises `payout.requested` with emit(), so
   * the rejection never reaches it: the mismatch the domain-events README warns about. Throws synchronously, as a
   * validation step would.
   */
  @OnCriticalEvent(DEMO_EVENTS.PAYOUT_REQUESTED)
  approvePayout(event: PayoutRequested) {
    if (event.overLimit) throw new Error(`Payout ${event.payoutId} is over the daily limit`);
  }
}

export const DEMO_EVENT_LISTENERS = [InvoiceMailer, CustomerPortal, Ledger, ReceiptMailer, Treasury];
