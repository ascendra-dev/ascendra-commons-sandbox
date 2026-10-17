import { describe, expect, it } from 'vitest';
import { diffFields } from './field-diff';

describe('diffFields', () => {
  it('reports only the keys whose value actually changed', () => {
    expect(diffFields({ status: 'awaiting_payment', paidAt: null, amount: 4820 }, { status: 'paid', paidAt: '2026-09-07T09:41:02Z', amount: 4820 })).toEqual([
      { field: 'paidAt', before: null, after: '2026-09-07T09:41:02Z' },
      { field: 'status', before: 'awaiting_payment', after: 'paid' },
    ]);
  });

  it('treats null before/after as an empty object', () => {
    expect(diffFields(null, { status: 'created' })).toEqual([{ field: 'status', before: null, after: 'created' }]);
    expect(diffFields({ status: 'deleted' }, null)).toEqual([{ field: 'status', before: 'deleted', after: null }]);
    expect(diffFields(null, null)).toEqual([]);
  });

  it('treats a key present on only one side as null on the other', () => {
    expect(diffFields({ a: 1 }, { a: 1, b: 2 })).toEqual([{ field: 'b', before: null, after: 2 }]);
  });

  it('returns an empty array when nothing changed', () => {
    expect(diffFields({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual([]);
  });

  it('deep-compares nested object/array values instead of reference-comparing them', () => {
    expect(diffFields({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toEqual([]);
    expect(diffFields({ tags: ['a', 'b'] }, { tags: ['a', 'c'] })).toEqual([{ field: 'tags', before: ['a', 'b'], after: ['a', 'c'] }]);
  });

  it('reports a change inside a nested object at its dot path, not as the whole object', () => {
    const before = { name: 'Ayesha', address: { street: '12 Old Rd', city: 'Lahore', geo: { lat: 31.5 } } };
    const after = { name: 'Ayesha', address: { street: '7 New St', city: 'Lahore', geo: { lat: 31.6 } } };
    expect(diffFields(before, after)).toEqual([
      { field: 'address.geo.lat', before: 31.5, after: 31.6 },
      { field: 'address.street', before: '12 Old Rd', after: '7 New St' },
    ]);
  });

  it('reports each leaf of a nested object added or removed as a whole', () => {
    expect(diffFields({ address: null }, { address: { street: '7 New St', city: 'Lahore' } })).toEqual([
      { field: 'address.city', before: null, after: 'Lahore' },
      { field: 'address.street', before: null, after: '7 New St' },
    ]);
    expect(diffFields({ address: { street: '7 New St' } }, {})).toEqual([
      { field: 'address.street', before: '7 New St', after: null },
    ]);
  });

  it('ignores key order inside nested objects', () => {
    expect(diffFields({ address: { street: 'a', city: 'b' } }, { address: { city: 'b', street: 'a' } })).toEqual([]);
  });

  it('keeps arrays, including arrays of objects, as single values', () => {
    expect(diffFields({ lines: [{ sku: 'a' }] }, { lines: [{ sku: 'a' }, { sku: 'b' }] })).toEqual([
      { field: 'lines', before: [{ sku: 'a' }], after: [{ sku: 'a' }, { sku: 'b' }] },
    ]);
  });

  it('keeps an empty object as a leaf', () => {
    expect(diffFields({ meta: {} }, { meta: { source: 'api' } })).toEqual([
      { field: 'meta', before: {}, after: null },
      { field: 'meta.source', before: null, after: 'api' },
    ]);
  });

  it('sorts diff entries by field name', () => {
    expect(diffFields({ z: 1, a: 1 }, { z: 2, a: 2 })).toEqual([
      { field: 'a', before: 1, after: 2 },
      { field: 'z', before: 1, after: 2 },
    ]);
  });
});
