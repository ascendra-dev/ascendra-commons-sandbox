/**
 * Every 403 `AuthorizationGuard` answers, handed to an optional recorder — so an admin can see who tried what and was
 * refused (a missing grant behind a "why can't I", or someone probing). Bound under `ACCESS_DENIAL_RECORDER` via
 * `AuthorizationModule.forRoot({ denialRecorderToken })`; nothing is recorded when it isn't.
 *
 * `recordDenial` is called on the request path — possibly an attacker's, at their rate — so an implementation must
 * not do I/O per call (buffer, count, write in batches) and must not throw. The guard ignores what it returns and
 * catches anything it throws.
 */
export interface AccessDenial {
  actorId: string;
  tenantId: string | null;
  /** The action the route required. */
  action: string;
  /** HTTP method. */
  method: string;
  /** The route pattern (`/authz/users/:userId/roles`) — never the resolved URL, which can carry ids and secrets. */
  route: string;
  /** The inbound `x-correlation-id`, when well-formed. */
  correlationId?: string;
  at: Date;
}

export interface AccessDenialRecorder {
  recordDenial(denial: AccessDenial): void;
}
