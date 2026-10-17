import { describe, expect, it } from 'vitest';
import { ExecutionContext, ForbiddenException, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthorizationModule } from './authorization.module';
import { AuthorizationGuard, AuthorizationNotDeclaredError } from './authorization.guard';
import { RequiresAction, NoActionRequired } from './requires-action.decorator';
import { MissingAuthorizer, MissingAuthorizerError } from './missing-authorizer';
import { Authorizer } from './authorizer.port';
import { AUTHORIZER } from './tokens';

/**
 * A real class with the real @RequiresAction() decorator applied — not a
 * fake metadata stub the way authorization.guard.spec.ts uses one, to prove
 * the decorator and AuthorizationGuard's Reflector.get() actually agree with
 * each other when both go through real reflect-metadata.
 */
@Injectable()
class TestController {
  @RequiresAction('invoice.void')
  voidInvoice() {
    return 'ok';
  }

  @NoActionRequired()
  publicPing() {
    return 'ok';
  }

  undeclared() {
    return 'ok';
  }
}

function contextFor(handler: () => unknown, actor?: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => (actor ? { actor } : {}) }),
    getHandler: () => handler,
    getClass: () => TestController,
  } as unknown as ExecutionContext;
}

const ISSUER_CAN_VOID = Symbol('ISSUER_CAN_VOID');

@Module({
  providers: [
    {
      provide: ISSUER_CAN_VOID,
      useValue: {
        can: async (actor: { persona: string }, action: string) =>
          actor.persona === 'issuer' && action === 'invoice.void',
      } satisfies Authorizer,
    },
  ],
  exports: [ISSUER_CAN_VOID],
})
class FakeAuthorizerModule {}

describe('AuthorizationModule.forRoot — token wiring', () => {
  describe('with an authorizerToken', () => {
    async function build() {
      return Test.createTestingModule({
        imports: [
          AuthorizationModule.forRoot({ authorizerToken: ISSUER_CAN_VOID, imports: [FakeAuthorizerModule] }),
        ],
        providers: [TestController],
      }).compile();
    }

    it('aliases AUTHORIZER to the token from imports', async () => {
      const moduleRef = await build();
      const authorizer = moduleRef.get<Authorizer>(AUTHORIZER);

      await expect(authorizer.can({ id: 'u1', persona: 'issuer', tenantId: 't1' }, 'invoice.void')).resolves.toBe(true);
      await expect(authorizer.can({ id: 'u2', persona: 'payer', tenantId: null }, 'invoice.void')).resolves.toBe(false);
    });

    it('resolves AuthorizationGuard, and it reads real @RequiresAction() metadata via a real Reflector', async () => {
      const moduleRef = await build();
      const guard = moduleRef.get(AuthorizationGuard);
      const controller = moduleRef.get(TestController);

      const allowed = contextFor(controller.voidInvoice, { id: 'u1', persona: 'issuer', tenantId: 't1' });
      await expect(guard.canActivate(allowed)).resolves.toBe(true);

      const denied = contextFor(controller.voidInvoice, { id: 'u2', persona: 'payer', tenantId: null });
      await expect(guard.canActivate(denied)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a real @NoActionRequired() handler through, real reflection included', async () => {
      const moduleRef = await build();
      const guard = moduleRef.get(AuthorizationGuard);
      const controller = moduleRef.get(TestController);

      await expect(guard.canActivate(contextFor(controller.publicPing))).resolves.toBe(true);
    });

    it('deny-by-default: a real handler with neither decorator throws AuthorizationNotDeclaredError', async () => {
      const moduleRef = await build();
      const guard = moduleRef.get(AuthorizationGuard);
      const controller = moduleRef.get(TestController);

      await expect(guard.canActivate(contextFor(controller.undeclared))).rejects.toBeInstanceOf(
        AuthorizationNotDeclaredError,
      );
    });
  });

  describe('with no authorizerToken — the loud stub', () => {
    async function build() {
      return Test.createTestingModule({
        imports: [AuthorizationModule.forRoot()],
      }).compile();
    }

    it('binds AUTHORIZER to the throwing MissingAuthorizer', async () => {
      const moduleRef = await build();
      expect(moduleRef.get(AUTHORIZER)).toBeInstanceOf(MissingAuthorizer);
    });

    it('rejects can() with MissingAuthorizerError', async () => {
      const moduleRef = await build();
      const authorizer = moduleRef.get<Authorizer>(AUTHORIZER);
      await expect(
        authorizer.can({ id: 'u1', persona: 'issuer', tenantId: 't1' }, 'invoice.void'),
      ).rejects.toBeInstanceOf(MissingAuthorizerError);
    });

    it('still resolves AuthorizationGuard', async () => {
      const moduleRef = await build();
      expect(moduleRef.get(AuthorizationGuard)).toBeInstanceOf(AuthorizationGuard);
    });
  });
});
