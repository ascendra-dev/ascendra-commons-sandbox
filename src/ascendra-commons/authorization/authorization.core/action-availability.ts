import { Actor } from './actor.type';
import { Authorizer } from './authorizer.port';

/**
 * The shape every per-entity action field uses (e.g. an InvoiceDto's
 * `actions.void`). 'not_permitted' -> hide the control (a permission fact,
 * true for this actor on any instance). 'invalid_state' -> render it
 * disabled with `message` as the tooltip (a state fact, true only for this
 * particular record right now). Conflating the two produces a disabled
 * control the user can never figure out how to enable — see this module's
 * README, "Hide vs. disable."
 */
export type ActionAvailability =
  | { allowed: true }
  | { allowed: false; reason: 'not_permitted' | 'invalid_state'; message?: string };

export interface StateValidity {
  valid: boolean;
  message?: string;
}

/**
 * The two-step check every per-entity action computation follows: permission
 * first, then business state — in that order, since a state check on a
 * record the actor isn't even permitted to act on would leak information
 * about that record's state to someone who shouldn't see it. stateCheck is
 * only called at all once the permission check has already passed.
 *
 * A project's own per-entity actions function calls this once per action:
 *
 *   async function computeInvoiceActions(actor: Actor, invoice: Invoice, authorizer: Authorizer) {
 *     return {
 *       void: await computeActionAvailability(actor, Actions.INVOICE_VOID, authorizer,
 *         () => invoice.status === 'paid'
 *           ? { valid: false, message: 'Cannot void a paid invoice' }
 *           : { valid: true }),
 *       download: { allowed: true as const },
 *     };
 *   }
 *
 * `stateCheck` may be sync or async. A check against an already-loaded entity
 * is a plain sync property read (the common case, above); one that needs a
 * further lookup (e.g. "does this invoice have unpaid children") returns a
 * Promise — and because it only runs after the permission check passes, that
 * lookup is never issued for a record the actor can't act on. Same async-from-
 * the-start reasoning `Authorizer.can()` is built on.
 */
export async function computeActionAvailability(
  actor: Actor,
  action: string,
  authorizer: Authorizer,
  stateCheck?: () => StateValidity | Promise<StateValidity>,
): Promise<ActionAvailability> {
  if (!(await authorizer.can(actor, action))) {
    return { allowed: false, reason: 'not_permitted' };
  }
  if (stateCheck) {
    const state = await stateCheck();
    if (!state.valid) {
      return { allowed: false, reason: 'invalid_state', message: state.message };
    }
  }
  return { allowed: true };
}
