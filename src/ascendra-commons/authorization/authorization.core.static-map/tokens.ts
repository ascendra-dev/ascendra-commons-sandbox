/**
 * Injection tokens for Model 1 (static persona map). Symbols, not string
 * literals — a typo in a binding is a compile error, not a silently unbound
 * provider.
 */

/** The raw persona -> allowed actions map `StaticRoleMapAuthorizer` reads. Consumer-supplied via `StaticMapAuthorizerModule.forRoot()`. */
export const PERSONA_ACTIONS_DATA = Symbol('PERSONA_ACTIONS_DATA');

/**
 * What `StaticMapAuthorizerModule` exports as its `Authorizer` implementation.
 * Pass it to `AuthorizationModule.forRoot({ authorizerToken: STATIC_MAP_AUTHORIZER })`.
 */
export const STATIC_MAP_AUTHORIZER = Symbol('STATIC_MAP_AUTHORIZER');
