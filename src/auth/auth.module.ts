import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthorizationGuard, AuthorizationModule } from '../ascendra-commons/authorization/authorization.core';
import { StaticMapAuthorizerModule, STATIC_MAP_AUTHORIZER } from '../ascendra-commons/authorization/authorization.core.static-map';
import { PERSONA_ACTIONS } from './dev-actors';
import { DevAuthController } from './dev-auth.controller';
import { DevAuthGuard } from './dev-auth.guard';
import { DevTokenService } from './dev-token.service';
import { MeController } from './me.controller';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Authentication (dev tokens) + authorization (the vendored static-map model). Both guards are global and run in
 * this order — authentication first, so `request.actor` is set before AuthorizationGuard reads it. AuthorizationGuard
 * is deny-by-default: a route with neither `@RequiresAction` nor `@NoActionRequired` fails with a 500.
 */
@Module({
  imports: [
    AuthorizationModule.forRoot({
      authorizerToken: STATIC_MAP_AUTHORIZER,
      imports: [StaticMapAuthorizerModule.forRoot({ personaActions: PERSONA_ACTIONS })],
    }),
  ],
  controllers: [MeController, ...(isProduction ? [] : [DevAuthController])],
  providers: [
    DevTokenService,
    { provide: APP_GUARD, useClass: DevAuthGuard },
    { provide: APP_GUARD, useExisting: AuthorizationGuard },
  ],
})
export class AuthModule {}
