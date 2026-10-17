import { DomainEvent } from './domain-event.interface';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Thrown by assertDomainEventSerializable() when an event would not survive a JSON transport intact. */
export class DomainEventNotSerializableError extends Error {
  constructor(public readonly reasons: readonly string[]) {
    super(
      'Domain event will not survive a JSON transport intact:\n' +
        reasons.map((r) => `  - ${r}`).join('\n'),
    );
    this.name = 'DomainEventNotSerializableError';
  }
}

/**
 * Fails if `event` contains anything that `JSON.stringify` would drop, corrupt,
 * or throw on — so an event that passes here today can be handed to a message
 * broker (Model 2) unchanged. Model 1 passes the live instance in-process and
 * does not need this; it is a design-time guard, meant to be called from each
 * event class's own `.spec.ts` with a fully-populated instance:
 *
 *   it('is serializable', () => {
 *     assertDomainEventSerializable(
 *       new InvoiceStatusChanged('inv_1', 'ten_1', 'draft', 'sent', 'usr_1'),
 *     );
 *   });
 *
 * Detects, recursively:
 * - functions, `undefined`, symbols, `bigint` (dropped, or `JSON.stringify` throws)
 * - `NaN` / `Infinity` (become `null`)
 * - `Map`, `Set`, typed arrays, and class instances other than `Date` and plain
 *   objects (`Date` is allowed — `JSON.stringify` emits a round-trippable ISO string)
 * - circular references
 * - methods on the event's class or any nested object — the structure survives
 *   but a broker delivers data only, so `event.someMethod()` on the far side breaks
 */
export function assertDomainEventSerializable(event: DomainEvent): void {
  const reasons: string[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown, path: string): void => {
    const label = path || 'event';

    if (value === null) return;

    switch (typeof value) {
      case 'string':
      case 'boolean':
        return;
      case 'number':
        if (!Number.isFinite(value)) reasons.push(`${label} is ${String(value)} (becomes null)`);
        return;
      case 'function':
        reasons.push(`${label} is a function`);
        return;
      case 'undefined':
        reasons.push(`${label} is undefined (JSON.stringify drops it)`);
        return;
      case 'symbol':
        reasons.push(`${label} is a symbol`);
        return;
      case 'bigint':
        reasons.push(`${label} is a bigint (JSON.stringify throws)`);
        return;
    }

    const obj = value as object;
    if (seen.has(obj)) {
      reasons.push(`${label} is a circular reference`);
      return;
    }
    seen.add(obj);

    if (obj instanceof Date) return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => visit(item, `${label}[${i}]`));
      return;
    }
    if (obj instanceof Map || obj instanceof Set) {
      reasons.push(`${label} is a ${obj.constructor.name} (serializes to {})`);
      return;
    }
    if (ArrayBuffer.isView(obj)) {
      reasons.push(`${label} is a ${obj.constructor.name} (typed array — not JSON)`);
      return;
    }

    const proto = Object.getPrototypeOf(obj) as object | null;
    if (proto !== null && proto !== Object.prototype) {
      const methods = Object.getOwnPropertyNames(proto).filter(
        (name) => name !== 'constructor' && typeof (proto as Record<string, unknown>)[name] === 'function',
      );
      if (methods.length > 0) {
        const cls = (obj as { constructor?: { name?: string } }).constructor?.name ?? 'class';
        reasons.push(`${label} is a ${cls} with method(s) ${methods.join(', ')} — a broker delivers data only`);
      }
    }

    for (const [key, nested] of Object.entries(obj)) {
      visit(nested, path ? `${path}.${key}` : key);
    }
  };

  visit(event, '');

  try {
    if (JSON.stringify(event) === undefined) reasons.push('JSON.stringify(event) returned undefined');
  } catch (err) {
    reasons.push(`JSON.stringify threw: ${(err as Error).message}`);
  }

  if (reasons.length > 0) throw new DomainEventNotSerializableError([...new Set(reasons)]);
}
