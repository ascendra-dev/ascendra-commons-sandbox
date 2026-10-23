import { DynamicModule, Module, type Provider } from '@nestjs/common';
import { AuthorizationGuard } from './authorization.guard';
import { MissingAuthorizer } from './missing-authorizer';
import { ACCESS_DENIAL_RECORDER, AUTHORIZER } from './tokens';

export interface AuthorizationModuleConfig {
  /**
   * The injection token an `Authorizer` implementation is already provided
   * under by a module in `imports`. `useExisting`-aliased to `AUTHORIZER`, so
   * every call site (`@Inject(AUTHORIZER)`, `AuthorizationGuard`,
   * `computeSessionSnapshot`) is unaffected by which model is bound.
   *
   *   - Model 1: `STATIC_MAP_AUTHORIZER` (authorization.core.static-map)
   *   - Model 2: `PERMISSION_TABLE_AUTHORIZER`
   *     (authorization.core.permission-table.<stack>)
   *   - or your own token on another stack.
   *
   * Omit it and the throwing `MissingAuthorizer` stub is bound instead, so
   * "AuthorizationModule imported but no model wired" fails loudly on the
   * first `can()` rather than silently.
   */
  authorizerToken?: string | symbol | (new (...args: never[]) => unknown);
  /**
   * Whatever module(s) export the provider behind `authorizerToken`.
   * `useExisting` only resolves a token NestJS can already see in *this*
   * module's own providers or imports — not the wider application graph.
   */
  imports?: DynamicModule['imports'];
  /**
   * Optional. The token an `AccessDenialRecorder` is provided under by a module in `imports` — e.g.
   * `POSTGRES_ACCESS_DENIAL_RECORDER`. Every 403 the guard answers is handed to it.
   */
  denialRecorderToken?: string | symbol | (new (...args: never[]) => unknown);
}

/**
 * The model-agnostic core. `forRoot()` is pure token wiring: it binds
 * `AUTHORIZER` to `authorizerToken` (or to `MissingAuthorizer`) and provides
 * `AuthorizationGuard`. It ships no `Authorizer` implementation — Model 1 and
 * Model 2 each live in their own package and wire identically, by passing
 * their module to `imports` and their token to `authorizerToken`.
 *
 * Does not apply `AuthorizationGuard` globally — it's provided and exported so
 * the consuming project decides how to wire it: globally via `APP_GUARD`, or
 * per-controller/per-route via `@UseGuards(AuthorizationGuard)`. See this
 * module's README.
 */
@Module({})
export class AuthorizationModule {
  static forRoot(config: AuthorizationModuleConfig = {}): DynamicModule {
    const providers: Provider[] = config.authorizerToken
      ? [{ provide: AUTHORIZER, useExisting: config.authorizerToken }, AuthorizationGuard]
      : [MissingAuthorizer, { provide: AUTHORIZER, useExisting: MissingAuthorizer }, AuthorizationGuard];
    if (config.denialRecorderToken) {
      providers.push({ provide: ACCESS_DENIAL_RECORDER, useExisting: config.denialRecorderToken });
    }

    return {
      module: AuthorizationModule,
      imports: config.imports ?? [],
      providers,
      exports: [AUTHORIZER, AuthorizationGuard],
    };
  }
}
