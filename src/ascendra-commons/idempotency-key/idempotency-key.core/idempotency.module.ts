import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ActorScopeResolver } from './actor-scope-resolver';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IDEMPOTENCY_SCOPE_RESOLVER, IDEMPOTENCY_STORE } from './tokens';

type OverrideToken = string | symbol | (new (...args: never[]) => unknown);

export interface IdempotencyModuleConfig {
  /**
   * The injection token an `IdempotencyStore` implementation is provided under
   * by a module in `imports`. `useExisting`-aliased to `IDEMPOTENCY_STORE`.
   *
   *   - Model 1: `POSTGRES_IDEMPOTENCY_STORE` (idempotency-key.core.postgres-drizzle)
   *   - Model 2: `REDIS_IDEMPOTENCY_STORE` (idempotency-key.core.redis) — wires, but
   *     throws `RedisIdempotencyStoreNotImplementedError` until built
   *   - or your own store.
   *
   * `.core` ships no store.
   */
  storeToken: OverrideToken;

  /**
   * The consumer's own `IdempotencyScopeResolver` token, for an endpoint
   * reachable without an authenticated actor. Omit to use `ActorScopeResolver`
   * (the authenticated-only default).
   */
  scopeResolverToken?: OverrideToken;

  /**
   * Whatever module(s) export the providers behind `storeToken` /
   * `scopeResolverToken`. `useExisting` only resolves a token NestJS can
   * already see in *this* module's own providers or imports.
   */
  imports?: DynamicModule['imports'];
}

/**
 * The backend-agnostic core. `forRoot()` is pure token wiring — it binds
 * `IDEMPOTENCY_STORE` to `storeToken`, the scope resolver (default or the
 * consumer's), and provides `IdempotencyInterceptor`.
 *
 * Does not apply `IdempotencyInterceptor` to anything — it's provided and
 * exported so the consumer decides per-endpoint via
 * `@UseInterceptors(IdempotencyInterceptor)`, on exactly the endpoints where a
 * duplicate is genuinely costly, never by default.
 */
@Module({})
export class IdempotencyModule {
  static forRoot(config: IdempotencyModuleConfig): DynamicModule {
    if (!config?.storeToken) {
      throw new Error(
        'IdempotencyModule.forRoot() requires storeToken — POSTGRES_IDEMPOTENCY_STORE from ' +
          'idempotency-key.core.postgres-drizzle (Model 1), REDIS_IDEMPOTENCY_STORE from ' +
          'idempotency-key.core.redis (Model 2), or your own IdempotencyStore token.',
      );
    }

    const scopeResolverProvider: Provider = config.scopeResolverToken
      ? { provide: IDEMPOTENCY_SCOPE_RESOLVER, useExisting: config.scopeResolverToken }
      : { provide: IDEMPOTENCY_SCOPE_RESOLVER, useClass: ActorScopeResolver };

    return {
      module: IdempotencyModule,
      imports: config.imports ?? [],
      providers: [
        { provide: IDEMPOTENCY_STORE, useExisting: config.storeToken },
        scopeResolverProvider,
        IdempotencyInterceptor,
      ],
      exports: [IDEMPOTENCY_STORE, IdempotencyInterceptor],
    };
  }
}
