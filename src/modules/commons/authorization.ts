import { AuthorizationModule } from '../../ascendra-commons/authorization/authorization.core';
import { StaticMapAuthorizerModule, STATIC_MAP_AUTHORIZER } from '../../ascendra-commons/authorization/authorization.core.static-map';
import { AUDIT_ACTIONS } from '../../ascendra-commons/audit-logging/audit-logging.api';
import { DOMAIN_EVENTS_ACTIONS } from '../../ascendra-commons/domain-events/domain-events.api';
import { IDEMPOTENCY_ACTIONS } from '../../ascendra-commons/idempotency-key/idempotency-key.api';
import { RATE_LIMIT_ACTIONS } from '../../ascendra-commons/rate-limiting/rate-limiting.api';

/** Every action this app knows — `GET /me` reports which of these the actor holds. */
export const ALL_ACTIONS: string[] = [
  ...Object.values(AUDIT_ACTIONS),
  ...Object.values(RATE_LIMIT_ACTIONS),
  ...Object.values(IDEMPOTENCY_ACTIONS),
  ...Object.values(DOMAIN_EVENTS_ACTIONS),
];

/**
 * Persona → actions, for the static-map authorizer (Model 1). An unlisted persona is denied everything.
 * `rate-limit.view` is platform-only: a rejection has no tenant (the caller wasn't signed in), so a tenant admin
 * would see every tenant's traffic. `idempotency.view` too — a claim's scope is opaque to the module, so it can't be
 * limited to one tenant. `idempotency.view-response` (a claim's saved body — it can hold personal data) is the platform
 * admin's alone: platform support sees every claim but gets a 403 on its body. `domain-events.view` is platform-only too:
 * a delivery row has no tenant (the payload isn't stored), and the wiring it shows is the whole app's.
 */
export const PERSONA_ACTIONS: Record<string, string[]> = {
  'platform-admin': [
    AUDIT_ACTIONS.VIEW,
    RATE_LIMIT_ACTIONS.VIEW,
    IDEMPOTENCY_ACTIONS.VIEW,
    IDEMPOTENCY_ACTIONS.VIEW_RESPONSE,
    DOMAIN_EVENTS_ACTIONS.VIEW,
  ],
  'platform-support': [RATE_LIMIT_ACTIONS.VIEW, IDEMPOTENCY_ACTIONS.VIEW, DOMAIN_EVENTS_ACTIONS.VIEW],
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
