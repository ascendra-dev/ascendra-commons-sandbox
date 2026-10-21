/**
 * scope is the acting tenant/actor id, not just the raw key — so one
 * tenant's idempotency key can never collide with another's, the same
 * reasoning applied everywhere else tenancy is enforced.
 *
 * Not every endpoint this pattern is enforced on necessarily has an
 * authenticated actor — an anonymous caller following a signed link (a
 * payment link, most concretely) has no Actor at all. Deriving scope is
 * therefore its own small, swappable concern rather than inline logic in
 * the interceptor: ActorScopeResolver is the default for the authenticated
 * case; an endpoint reachable anonymously needs a project-specific resolver
 * deriving scope from whatever *does* identify the request in that case.
 * This interface only requires that whatever scope value comes back be
 * stable and unique to the logical requester, so two different anonymous
 * attempts can never collide and one can't collide with an authenticated one.
 *
 * Returns Promise<string>, not string — an anonymous-case resolver will
 * plausibly need to validate a token against a database, which is
 * inherently async. Keeping the interface async from the start, the same
 * reasoning Authorizer.can() uses, means that case is a drop-in
 * implementation later, not a breaking interface change.
 */
export interface IdempotencyScopeResolver {
  resolveScope(request: unknown): Promise<string>;
}
