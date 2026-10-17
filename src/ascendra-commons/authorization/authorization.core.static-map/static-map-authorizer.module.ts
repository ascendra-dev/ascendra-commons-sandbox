import { DynamicModule, Module } from '@nestjs/common';
import { StaticRoleMapAuthorizer } from './static-role-map.authorizer';
import { PERSONA_ACTIONS_DATA, STATIC_MAP_AUTHORIZER } from './tokens';

export interface StaticMapAuthorizerModuleConfig {
  /**
   * persona -> allowed actions, or `'*'` for unrestricted. Required — there's
   * no sensible default persona/action map. `forRoot()` throws if omitted.
   */
  personaActions: Record<string, string[] | '*'>;
}

/**
 * Model 1 wiring. Binds `StaticRoleMapAuthorizer` (reading `personaActions`) and
 * exports it under `STATIC_MAP_AUTHORIZER`. Hand that token to
 * `AuthorizationModule.forRoot({ authorizerToken: STATIC_MAP_AUTHORIZER, imports: [StaticMapAuthorizerModule.forRoot({ personaActions })] })`.
 */
@Module({})
export class StaticMapAuthorizerModule {
  static forRoot(config: StaticMapAuthorizerModuleConfig): DynamicModule {
    if (!config?.personaActions) {
      throw new Error(
        'StaticMapAuthorizerModule.forRoot() requires personaActions — a persona -> actions map ' +
          "(values are string[] or '*'). See StaticRoleMapAuthorizer.",
      );
    }

    return {
      module: StaticMapAuthorizerModule,
      providers: [
        { provide: PERSONA_ACTIONS_DATA, useValue: config.personaActions },
        StaticRoleMapAuthorizer,
        { provide: STATIC_MAP_AUTHORIZER, useExisting: StaticRoleMapAuthorizer },
      ],
      exports: [STATIC_MAP_AUTHORIZER],
    };
  }
}
