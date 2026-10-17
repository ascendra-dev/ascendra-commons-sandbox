import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AuthorizationModule, AuthorizationGuard, AUTHORIZER } from '../authorization.core';
import type { Authorizer } from '../authorization.core';
import { StaticMapAuthorizerModule } from './static-map-authorizer.module';
import { StaticRoleMapAuthorizer } from './static-role-map.authorizer';
import { STATIC_MAP_AUTHORIZER } from './tokens';

describe('StaticMapAuthorizerModule', () => {
  it('throws when personaActions is omitted', () => {
    // @ts-expect-error — deliberately calling without the required config
    expect(() => StaticMapAuthorizerModule.forRoot({})).toThrow(/requires personaActions/);
  });

  describe('wired through AuthorizationModule.forRoot — real DI', () => {
    async function build() {
      return Test.createTestingModule({
        imports: [
          AuthorizationModule.forRoot({
            authorizerToken: STATIC_MAP_AUTHORIZER,
            imports: [
              StaticMapAuthorizerModule.forRoot({
                personaActions: { issuer: ['invoice.void', 'invoice.manage'], payer: [] },
              }),
            ],
          }),
        ],
      }).compile();
    }

    it('resolves AUTHORIZER to a working StaticRoleMapAuthorizer', async () => {
      const moduleRef = await build();
      const authorizer = moduleRef.get<Authorizer>(AUTHORIZER);

      expect(authorizer).toBeInstanceOf(StaticRoleMapAuthorizer);
      await expect(authorizer.can({ id: 'u1', persona: 'issuer', tenantId: 't1' }, 'invoice.void')).resolves.toBe(true);
      await expect(authorizer.can({ id: 'u2', persona: 'payer', tenantId: null }, 'invoice.void')).resolves.toBe(false);
    });

    it('resolves AuthorizationGuard against the same bound authorizer', async () => {
      const moduleRef = await build();
      expect(moduleRef.get(AuthorizationGuard)).toBeInstanceOf(AuthorizationGuard);
    });
  });
});
