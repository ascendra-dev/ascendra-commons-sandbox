import { describe, expect, it } from 'vitest';
import { MissingAuthorizer, MissingAuthorizerError } from './missing-authorizer';

const ACTOR = { id: 'u1', persona: 'issuer', tenantId: 't1' };

describe('MissingAuthorizer — bound when forRoot() gets no authorizerToken', () => {
  it('rejects can() with MissingAuthorizerError', async () => {
    const authorizer = new MissingAuthorizer();

    await expect(authorizer.can(ACTOR, 'invoice.void')).rejects.toBeInstanceOf(MissingAuthorizerError);
  });

  it('does not implement allowedActions (falls back to the can() loop, which then throws)', () => {
    expect((new MissingAuthorizer() as { allowedActions?: unknown }).allowedActions).toBeUndefined();
  });
});
