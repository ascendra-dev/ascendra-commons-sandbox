import { describe, expect, it } from 'vitest';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DiscoveryModule } from '@nestjs/core';
import { OnCriticalEvent } from '../domain-events.core';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEventListenerCatalog } from './domain-event-listener-catalog.service';

@Injectable()
class InvoiceNotificationListener {
  @OnEvent('invoice.sent')
  onInvoiceSent(): void {
    /* no-op */
  }
}

@Injectable()
class InvoiceAuditListener {
  @OnCriticalEvent('invoice.sent')
  onInvoiceSent(): void {
    /* no-op */
  }

  @OnEvent(['invoice.voided', 'invoice.refunded'])
  onInvoiceReversed(): void {
    /* no-op — a multi-event binding */
  }
}

describe('DomainEventListenerCatalog', () => {
  async function catalog() {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [InvoiceNotificationListener, InvoiceAuditListener, DomainEventListenerCatalog],
    }).compile();
    // Eager (non-request-scoped) providers are already instantiated by compile()
    // — no HTTP adapter (createNestApplication()) needed just to read them back.
    return moduleRef.get(DomainEventListenerCatalog);
  }

  it('discovers a plain @OnEvent() binding with the real class and method name', async () => {
    const entries = await (await catalog()).list();

    expect(entries).toContainEqual({
      eventName: 'invoice.sent',
      listenerClass: 'InvoiceNotificationListener',
      listenerMethod: 'onInvoiceSent',
      critical: false,
    });
  });

  it('discovers an @OnCriticalEvent() binding and marks it critical', async () => {
    const entries = await (await catalog()).list();

    expect(entries).toContainEqual({
      eventName: 'invoice.sent',
      listenerClass: 'InvoiceAuditListener',
      listenerMethod: 'onInvoiceSent',
      critical: true,
    });
  });

  it('flattens a multi-event @OnEvent([a, b]) binding into one entry per event', async () => {
    const entries = await (await catalog()).list();

    expect(entries).toContainEqual({
      eventName: 'invoice.voided',
      listenerClass: 'InvoiceAuditListener',
      listenerMethod: 'onInvoiceReversed',
      critical: false,
    });
    expect(entries).toContainEqual({
      eventName: 'invoice.refunded',
      listenerClass: 'InvoiceAuditListener',
      listenerMethod: 'onInvoiceReversed',
      critical: false,
    });
  });

  it('ignores methods with no @OnEvent()/@OnCriticalEvent() decorator', async () => {
    const entries = await (await catalog()).list();

    expect(entries.every((e) => e.listenerMethod === 'onInvoiceSent' || e.listenerMethod === 'onInvoiceReversed')).toBe(
      true,
    );
  });
});
