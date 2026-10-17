import { Actor } from './actor.type';

/**
 * The one contract every authorization model implements. Feature code injects
 * `AUTHORIZER` and calls `can()` — it never learns which model is bound.
 *
 * `authorization.core` ships no implementation of this interface. Model 1 is
 * `StaticRoleMapAuthorizer` (authorization.core.static-map); Model 2 is
 * `PermissionTableAuthorizer` (authorization.core.permission-table) backed by
 * a stack adapter. A project on another stack provides its own.
 *
 * `can()` returns `Promise<boolean>`, not `boolean`, even though a static
 * in-memory model never actually awaits anything — a database-backed model
 * genuinely needs to query a permissions table, which is inherently async.
 * Keeping the interface async from the start means swapping models is a true
 * drop-in later, not a breaking change to every call site.
 */
export interface Authorizer {
  can(actor: Actor, action: string): Promise<boolean>;

  /**
   * The subset of `candidateActions` this actor is permitted, resolved in one
   * pass. Optional — the per-action `can()` loop is the correct fallback.
   * A database-backed authorizer implements it so `computeSessionSnapshot`
   * (`/me`) is one query rather than one `can()` per action; an in-memory or
   * throwaway one can skip it.
   */
  allowedActions?(actor: Actor, candidateActions: string[]): Promise<string[]>;
}
