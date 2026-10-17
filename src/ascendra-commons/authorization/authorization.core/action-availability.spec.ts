import { describe, expect, it, vi } from 'vitest';
import { computeActionAvailability } from './action-availability';
import { Authorizer } from './authorizer.port';

const ACTOR = { id: 'u1', persona: 'issuer', tenantId: 't1' };

describe('computeActionAvailability', () => {
  it('returns not_permitted, and never calls stateCheck, when the actor lacks the permission', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(false) };
    const stateCheck = vi.fn(() => ({ valid: true }));

    const result = await computeActionAvailability(ACTOR, 'invoice.void', authorizer, stateCheck);

    expect(result).toEqual({ allowed: false, reason: 'not_permitted' });
    expect(stateCheck).not.toHaveBeenCalled();
  });

  it('returns invalid_state with the message when permitted but the state check fails', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };

    const result = await computeActionAvailability(ACTOR, 'invoice.void', authorizer, () => ({
      valid: false,
      message: 'Cannot void a paid invoice',
    }));

    expect(result).toEqual({ allowed: false, reason: 'invalid_state', message: 'Cannot void a paid invoice' });
  });

  it('returns allowed when permitted and the state check passes', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };

    const result = await computeActionAvailability(ACTOR, 'invoice.void', authorizer, () => ({ valid: true }));

    expect(result).toEqual({ allowed: true });
  });

  it('returns allowed when permitted and there is no state check at all', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };

    const result = await computeActionAvailability(ACTOR, 'invoice.download', authorizer);

    expect(result).toEqual({ allowed: true });
  });

  it('awaits an async stateCheck', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };

    const result = await computeActionAvailability(ACTOR, 'invoice.void', authorizer, async () => ({
      valid: false,
      message: 'Has unpaid child invoices',
    }));

    expect(result).toEqual({ allowed: false, reason: 'invalid_state', message: 'Has unpaid child invoices' });
  });

  it('never runs an async stateCheck when the actor lacks the permission', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(false) };
    const stateCheck = vi.fn(async () => ({ valid: true }));

    await computeActionAvailability(ACTOR, 'invoice.void', authorizer, stateCheck);

    expect(stateCheck).not.toHaveBeenCalled();
  });
});
