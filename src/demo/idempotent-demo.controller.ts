import { randomUUID } from 'node:crypto';
import { Body, Controller, Headers, Param, Post, UnprocessableEntityException, UseInterceptors } from '@nestjs/common';
import { NoActionRequired } from '../ascendra-commons/authorization/authorization.core';
import { IdempotencyInterceptor } from '../ascendra-commons/idempotency-key/idempotency-key.core';

/** Sandbox-only: how long a handler takes, so the generator can make a "gateway" slow. Capped. */
const DELAY_HEADER = 'x-demo-delay-ms';
const MAX_DELAY_MS = 10_000;

async function gatewayLatency(delayHeader: string | undefined): Promise<void> {
  const ms = Math.min(Math.max(Number(delayHeader) || 0, 0), MAX_DELAY_MS);
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

interface Party {
  name: string;
  email: string;
}

/**
 * Sandbox-only endpoints that opt into `IdempotencyInterceptor` — what a product puts it on: the calls a double-click
 * or a network retry must never repeat. No product behind them: each answers the way its real counterpart would, so
 * the idempotency generator (src/cli/idempotency-history.ts) can drive every outcome — a replay, a 409, a saved 422,
 * a claim left in progress, a request taken over while still running. Signed-in staff only (scope = their tenant);
 * `X-Demo-Delay-Ms` stands in for a slow gateway.
 */
@Controller('demo')
@NoActionRequired()
@UseInterceptors(IdempotencyInterceptor)
export class IdempotentDemoController {
  /** Take a payment. The response names the payer — why a saved body sits behind its own permission. */
  @Post('payments')
  async payment(
    @Body() body: { amount: number; currency: string; payer: Party },
    @Headers(DELAY_HEADER) delay?: string,
  ) {
    await gatewayLatency(delay);
    return { id: `pay_${randomUUID().slice(0, 8)}`, status: 'captured', amount: body.amount, currency: body.currency, payer: body.payer };
  }

  /** Send an invoice to its customer — through a mail gateway that can be slow. */
  @Post('invoices/:id/send')
  async sendInvoice(
    @Param('id') id: string,
    @Body() body: { customer: Party; amount: number; currency: string },
    @Headers(DELAY_HEADER) delay?: string,
  ) {
    await gatewayLatency(delay);
    return { id, status: 'sent', sentTo: body.customer.email, customer: body.customer.name, amount: body.amount, currency: body.currency };
  }

  /** Refund part of a payment. Over the captured amount is a 422 — saved, so every retry with that key gets it back. */
  @Post('refunds')
  async refund(@Body() body: { paymentId: string; amount: number; captured: number; currency: string }, @Headers(DELAY_HEADER) delay?: string) {
    await gatewayLatency(delay);
    if (body.amount > body.captured) {
      throw new UnprocessableEntityException(`The refund (${body.amount}) exceeds what payment ${body.paymentId} captured (${body.captured}).`);
    }
    return { id: `ref_${randomUUID().slice(0, 8)}`, status: 'refunded', paymentId: body.paymentId, amount: body.amount, currency: body.currency };
  }

  /**
   * Pay a supplier out. `gatewayTimeout` makes the payout gateway time out — an unexpected error, not an
   * HttpException, so nothing is saved and the claim stays in progress until it goes stale (a retry then re-runs it).
   */
  @Post('payouts')
  async payout(
    @Body() body: { supplier: Party; amount: number; currency: string; gatewayTimeout?: boolean },
    @Headers(DELAY_HEADER) delay?: string,
  ) {
    await gatewayLatency(delay);
    if (body.gatewayTimeout) throw new Error('The payout gateway did not answer in time.');
    return { id: `po_${randomUUID().slice(0, 8)}`, status: 'paid_out', supplier: body.supplier.name, amount: body.amount, currency: body.currency };
  }
}
