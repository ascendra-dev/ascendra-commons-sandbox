import { describe, expect, it } from 'vitest';
import { StaticRoleMapAuthorizer } from './static-role-map.authorizer';

describe('StaticRoleMapAuthorizer', () => {
  const authorizer = new StaticRoleMapAuthorizer({
    issuer: ['invoice.create', 'invoice.void'],
    payer: ['invoice.view'],
    ascendra_admin: '*',
  });

  it('allows an action explicitly listed for the actor persona', async () => {
    await expect(authorizer.can({ id: 'u1', persona: 'issuer', tenantId: 't1' }, 'invoice.create')).resolves.toBe(true);
  });

  it('denies an action not listed for the actor persona', async () => {
    await expect(authorizer.can({ id: 'u1', persona: 'payer', tenantId: null }, 'invoice.create')).resolves.toBe(false);
  });

  it("'*' grants every action unconditionally", async () => {
    const admin = { id: 'a1', persona: 'ascendra_admin', tenantId: null };
    await expect(authorizer.can(admin, 'invoice.create')).resolves.toBe(true);
    await expect(authorizer.can(admin, 'anything.at.all')).resolves.toBe(true);
  });

  it('denies (fails closed) for a persona with no entry in the map at all', async () => {
    await expect(authorizer.can({ id: 'u1', persona: 'unknown_persona', tenantId: null }, 'invoice.view')).resolves.toBe(
      false,
    );
  });

  describe('allowedActions — the one-pass resolution', () => {
    it('returns the intersection of the persona list and the candidates', async () => {
      const actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
      await expect(authorizer.allowedActions(actor, ['invoice.create', 'invoice.view', 'payment.refund'])).resolves.toEqual(
        ['invoice.create'],
      );
    });

    it("returns every candidate for a '*' persona", async () => {
      const admin = { id: 'a1', persona: 'ascendra_admin', tenantId: null };
      await expect(authorizer.allowedActions(admin, ['a.b', 'c.d'])).resolves.toEqual(['a.b', 'c.d']);
    });

    it('returns [] for an unconfigured persona', async () => {
      await expect(
        authorizer.allowedActions({ id: 'u1', persona: 'nope', tenantId: null }, ['invoice.view']),
      ).resolves.toEqual([]);
    });
  });
});
