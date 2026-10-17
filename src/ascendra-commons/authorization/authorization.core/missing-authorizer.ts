import { Injectable } from '@nestjs/common';
import { Actor } from './actor.type';
import { Authorizer } from './authorizer.port';

/** Thrown by every MissingAuthorizer method — no Authorizer implementation was wired. */
export class MissingAuthorizerError extends Error {
  constructor() {
    super(
      'AuthorizationModule.forRoot() was called without an authorizerToken, so no Authorizer ' +
        'is wired. Pass authorizerToken (+ imports) pointing at an implementation:\n' +
        "  - Model 1: StaticMapAuthorizerModule.forRoot({ personaActions }) from " +
        "'authorization.core.static-map', token STATIC_MAP_AUTHORIZER\n" +
        '  - Model 2: PostgresPermissionTableModule.forRoot({ ... }) from ' +
        "'authorization.core.permission-table.postgres-drizzle', token PERMISSION_TABLE_AUTHORIZER\n" +
        '  - or your own class on another stack.',
    );
    this.name = 'MissingAuthorizerError';
  }
}

/**
 * The "AuthorizationModule imported but no Authorizer wired" placeholder.
 * `forRoot()` binds this only when no `authorizerToken` is given, so the
 * mistake fails loudly on the first `can()` instead of silently letting every
 * request through (or crashing on an unbound provider).
 *
 * This is model-agnostic — it is not the Model 2 stub. Each model ships its
 * own real implementation in its own package.
 */
@Injectable()
export class MissingAuthorizer implements Authorizer {
  async can(_actor: Actor, _action: string): Promise<boolean> {
    throw new MissingAuthorizerError();
  }
}
