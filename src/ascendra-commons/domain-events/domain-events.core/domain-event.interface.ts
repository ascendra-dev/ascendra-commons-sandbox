/**
 * Marker interface for a domain event. Events are named for what already happened
 * (InvoiceSent, PaymentConfirmed), never as a command or intent, and carry the facts
 * of what changed — not just an id and not the entire serialized entity. Business
 * logic defines one plain class per fact; this interface only fixes the one field
 * every consumer (notably an audit listener's before/after record) needs uniformly.
 *
 * SERIALIZABILITY: an event must survive `JSON.stringify` intact, so the broker
 * transport (Model 2) can put it on a queue unchanged. Every field must be a
 * primitive, a plain object/array of those, or a `Date` (JSON.stringify emits a
 * round-trippable ISO string for it). No methods — events carry data, not
 * behavior — and no `Map`/`Set`/`BigInt`/`undefined`/other class instances.
 * `assertDomainEventSerializable()` enforces this; call it from each event
 * class's own .spec.ts, and optionally add the compile-time guard
 * `new SomeEvent(...) satisfies Record<string, JsonValue | Date>`.
 */
export interface DomainEvent {
  readonly occurredAt: Date;
}
