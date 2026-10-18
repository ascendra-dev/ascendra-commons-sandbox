import { AuthorizationModule } from '../../ascendra-commons/authorization/authorization.core';
import { StaticMapAuthorizerModule, STATIC_MAP_AUTHORIZER } from '../../ascendra-commons/authorization/authorization.core.static-map';
import { AUDIT_ACTIONS } from '../../ascendra-commons/audit-logging/audit-logging.api';

/** Every action this app knows — `GET /me` reports which of these the actor holds. */
export const ALL_ACTIONS: string[] = [...Object.values(AUDIT_ACTIONS)];

/** Persona → actions, for the static-map authorizer (Model 1). An unlisted persona is denied everything. */
export const PERSONA_ACTIONS: Record<string, string[]> = {
  'platform-admin': [AUDIT_ACTIONS.VIEW],
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
