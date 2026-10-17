/**
 * Injection tokens. Symbols, not string literals, same reasoning as every
 * other module in this library — a typo in a binding is a compile error, not
 * a silently unbound provider.
 */

/**
 * What AuthorizationGuard and feature code depend on — bound by
 * `AuthorizationModule.forRoot({ authorizerToken })` to whichever `Authorizer`
 * implementation the app wires (Model 1, Model 2, or a custom one). With no
 * `authorizerToken`, it is bound to the throwing `MissingAuthorizer` stub.
 */
export const AUTHORIZER = Symbol('AUTHORIZER');
