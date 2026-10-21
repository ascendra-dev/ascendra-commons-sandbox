import { AuthorizationModule } from '../../ascendra-commons/authorization/authorization.core';
import { StaticMapAuthorizerModule, STATIC_MAP_AUTHORIZER } from '../../ascendra-commons/authorization/authorization.core.static-map';
import { AUDIT_ACTIONS } from '../../ascendra-commons/audit-logging/audit-logging.api';
import { RATE_LIMIT_ACTIONS } from '../../ascendra-commons/rate-limiting/rate-limiting.api';

/** Every action this app knows — `GET /me` reports which of these the actor holds. */
export const ALL_ACTIONS: string[] = [...Object.values(AUDIT_ACTIONS), ...Object.values(RATE_LIMIT_ACTIONS)];

/**
 * Persona → actions, for the static-map authorizer (Model 1). An unlisted persona is denied everything.
 * `rate-limit.view` is platform-only: a rejection has no tenant (the caller wasn't signed in), so a tenant admin
 * would see every tenant's traffic.
 */
export const PERSONA_ACTIONS: Record<string, string[]> = {
  'platform-admin': [AUDIT_ACTIONS.VIEW, RATE_LIMIT_ACTIONS.VIEW],
  'tenant-admin': [AUDIT_ACTIONS.VIEW],
  member: [],
};

/**
 * authorization, Model 1 (static persona map). It reads `request.actor`, which authentication sets first — here the
 * dev sign-in (src/auth), in a product the real identity provider. The global guard order lives in src/auth.
 */
export const authorization = AuthorizationModule.forRoot({
  authorizerToken: STATIC_MAP_AUTHORIZER,
  imports: [StaticMapAuthorizerModule.forRoot({ personaActions: PERSONA_ACTIONS })],
});
