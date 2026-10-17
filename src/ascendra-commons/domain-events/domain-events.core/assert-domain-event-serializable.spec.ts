import { describe, expect, it } from 'vitest';
import {
  assertDomainEventSerializable,
  DomainEventNotSerializableError,
  JsonValue,
} from './assert-domain-event-serializable';
import { DomainEvent } from './domain-event.interface';

/**
 * Exactly the shape a consuming project's own event lives in — data-only fields,
 * a Date, an optional nullable field. This block is the worked example of what
 * each event class's .spec.ts should do.
 */
class InvoiceStatusChanged implements DomainEvent {
  readonly occurredAt = new Date('2026-02-01T00:00:00Z');
  constructor(
    public readonly invoiceId: string,
    public readonly tenantId: string,
    public readonly previousStatus: string,
    public readonly newStatus: string,
    public readonly changedBy: string,
    public readonly lineItemCount: number | null = null,
  ) {}
}

const sample = () => new InvoiceStatusChanged('inv_1', 'ten_1', 'draft', 'sent', 'usr_1', 3);

function loose(fields: Record<string, unknown>): DomainEvent {
  return { occurredAt: new Date(), ...fields } as unknown as DomainEvent;
}

describe('assertDomainEventSerializable', () => {
  it('passes a data-only event with primitives and a Date', () => {
    expect(() => assertDomainEventSerializable(sample())).not.toThrow();
  });

  it('passes nested plain objects and arrays of primitives', () => {
    expect(() =>
      assertDomainEventSerializable(
        loose({ before: { status: 'draft' }, after: { status: 'sent' }, tags: ['a', 'b'] }),
      ),
    ).not.toThrow();
  });

  it('has a compile-time companion guard', () => {
    // fails tsc if a field's type is not JSON-safe; the spread gives the object
    // literal the implicit index signature that a class instance lacks.
    ({ ...sample() }) satisfies Record<string, JsonValue | Date>;
  });

  it('rejects an event class with a method — a broker delivers data only', () => {
    class WithMethod implements DomainEvent {
      readonly occurredAt = new Date();
      constructor(public readonly invoiceId: string) {}
      toAuditRecord() {
        return { entityId: this.invoiceId };
      }
    }

    try {
      assertDomainEventSerializable(new WithMethod('inv_1'));
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainEventNotSerializableError);
      expect((err as DomainEventNotSerializableError).reasons.join()).toContain('toAuditRecord');
    }
  });

  it('rejects an undefined field', () => {
    expect(() => assertDomainEventSerializable(loose({ reason: undefined }))).toThrow(/undefined/);
  });

  it('rejects a Map', () => {
    expect(() => assertDomainEventSerializable(loose({ meta: new Map([['k', 'v']]) }))).toThrow(/Map/);
  });

  it('rejects a bigint', () => {
    expect(() => assertDomainEventSerializable(loose({ amount: 10n }))).toThrow(/bigint/);
  });

  it('rejects NaN', () => {
    expect(() => assertDomainEventSerializable(loose({ ratio: NaN }))).toThrow(/null/);
  });

  it('rejects a nested non-Date class instance carrying behavior', () => {
    class Money {
      constructor(public readonly cents: number) {}
      toString() {
        return `${this.cents / 100}`;
      }
    }
    expect(() => assertDomainEventSerializable(loose({ total: new Money(500) }))).toThrow(
      DomainEventNotSerializableError,
    );
  });

  it('rejects a circular reference', () => {
    const event: Record<string, unknown> = { occurredAt: new Date() };
    event.self = event;
    expect(() => assertDomainEventSerializable(event as unknown as DomainEvent)).toThrow(/circular/);
  });

  it('collects every distinct reason', () => {
    try {
      assertDomainEventSerializable(loose({ a: undefined, b: () => 1, c: new Set([1]) }));
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DomainEventNotSerializableError).reasons).toHaveLength(3);
    }
  });
});
