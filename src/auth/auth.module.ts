import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthorizationGuard } from '../ascendra-commons/authorization/authorization.core';
import { CommonsModule } from '../modules/commons/commons.module';
import { DevAuthController } from './dev-auth.controller';
import { DevAuthGuard } from './dev-auth.guard';
import { DevTokenService } from './dev-token.service';
import { MeController } from './me.controller';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Authentication — the dev sign-in standing in for a real identity provider (sandbox-only) — and the global guard
 * order: DevAuthGuard first, so `request.actor` is set before authorization's AuthorizationGuard (configured in
 * src/modules/commons) reads it. AuthorizationGuard is deny-by-default: a route with neither `@RequiresAction` nor
 * `@NoActionRequired` fails with a 500.
 */
@Module({
  imports: [CommonsModule],
  controllers: [MeController, ...(isProduction ? [] : [DevAuthController])],
  providers: [
    DevTokenService,
    { provide: APP_GUARD, useClass: DevAuthGuard },
    { provide: APP_GUARD, useExisting: AuthorizationGuard },
  ],
})
export class AuthModule {}
