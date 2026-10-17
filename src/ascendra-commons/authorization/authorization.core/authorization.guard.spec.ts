import { describe, expect, it, vi } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationGuard, AuthorizationNotDeclaredError } from './authorization.guard';
import { ACTION_METADATA_KEY, NO_ACTION_REQUIRED_KEY } from './requires-action.decorator';
import { Authorizer } from './authorizer.port';

const HANDLER = function handler() {};
const CONTROLLER = class Controller {};

type Meta = { action?: string; noAction?: boolean };

function makeGuard(authorizer: Authorizer, meta: { handler?: Meta; controller?: Meta } = {}) {
  const reflector = {
    get: vi.fn((key: string, target: unknown) => {
      const m = target === HANDLER ? meta.handler : meta.controller;
      if (!m) return undefined;
      if (key === ACTION_METADATA_KEY) return m.action;
      if (key === NO_ACTION_REQUIRED_KEY) return m.noAction;
      return undefined;
    }),
  } as unknown as Reflector;
  return new AuthorizationGuard(reflector, authorizer);
}

function ctx(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => HANDLER,
    getClass: () => CONTROLLER,
  } as unknown as ExecutionContext;
}

describe('AuthorizationGuard', () => {
  it('allows a permitted actor through a @RequiresAction() endpoint', async () => {
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };
    const guard = makeGuard(authorizer, { handler: { action: 'invoice.void' } });

    await expect(guard.canActivate(ctx({ actor: { id: 'u1', persona: 'issuer', tenantId: 't1' } }))).resolves.toBe(true);
  });

  it('throws ForbiddenException when the actor is present but not permitted', async () => {
    const actor = { id: 'u1', persona: 'payer', tenantId: null };
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(false) };
    const guard = makeGuard(authorizer, { handler: { action: 'invoice.void' } });

    await expect(guard.canActivate(ctx({ actor }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorizer.can).toHaveBeenCalledWith(actor, 'invoice.void');
  });

  it('throws UnauthorizedException when request.actor is missing on a gated endpoint', async () => {
    const authorizer: Authorizer = { can: vi.fn() };
    const guard = makeGuard(authorizer, { handler: { action: 'invoice.void' } });

    await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authorizer.can).not.toHaveBeenCalled();
  });

  it('deny-by-default: throws AuthorizationNotDeclaredError when neither decorator is present', async () => {
    const authorizer: Authorizer = { can: vi.fn() };
    const guard = makeGuard(authorizer, {});

    await expect(guard.canActivate(ctx({ actor: {} }))).rejects.toBeInstanceOf(AuthorizationNotDeclaredError);
    expect(authorizer.can).not.toHaveBeenCalled();
  });

  it('the thrown error names the offending Controller.handler()', async () => {
    const guard = makeGuard({ can: vi.fn() }, {});

    await expect(guard.canActivate(ctx({}))).rejects.toThrow(/Controller\.handler\(\)/);
  });

  it('@NoActionRequired() on the handler lets the request through with no can() check', async () => {
    const authorizer: Authorizer = { can: vi.fn() };
    const guard = makeGuard(authorizer, { handler: { noAction: true } });

    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
    expect(authorizer.can).not.toHaveBeenCalled();
  });

  it('falls back to a class-level @RequiresAction() when the handler declares nothing', async () => {
    const actor = { id: 'u1', persona: 'payer', tenantId: null };
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(false) };
    const guard = makeGuard(authorizer, { controller: { action: 'invoice.manage' } });

    await expect(guard.canActivate(ctx({ actor }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorizer.can).toHaveBeenCalledWith(actor, 'invoice.manage');
  });

  it('falls back to a class-level @NoActionRequired() when the handler declares nothing', async () => {
    const authorizer: Authorizer = { can: vi.fn() };
    const guard = makeGuard(authorizer, { controller: { noAction: true } });

    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
  });

  it('a method-level @NoActionRequired() wins over a class-level @RequiresAction()', async () => {
    const authorizer: Authorizer = { can: vi.fn() };
    const guard = makeGuard(authorizer, {
      handler: { noAction: true },
      controller: { action: 'invoice.manage' },
    });

    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
    expect(authorizer.can).not.toHaveBeenCalled();
  });

  it('a method-level @RequiresAction() wins over a class-level @NoActionRequired()', async () => {
    const actor = { id: 'u1', persona: 'issuer', tenantId: 't1' };
    const authorizer: Authorizer = { can: vi.fn().mockResolvedValue(true) };
    const guard = makeGuard(authorizer, {
      handler: { action: 'invoice.void' },
      controller: { noAction: true },
    });

    await expect(guard.canActivate(ctx({ actor }))).resolves.toBe(true);
    expect(authorizer.can).toHaveBeenCalledWith(actor, 'invoice.void');
  });
});
