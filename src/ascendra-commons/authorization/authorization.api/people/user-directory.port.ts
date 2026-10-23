/**
 * Who the app's users are — names, emails, which tenant each belongs to. Authorization only knows opaque user ids;
 * the app owns its users (an identity provider, a `users` table), so it implements this port and binds it under
 * `AUTHZ_USER_DIRECTORY`. Read-only: inviting, disabling or deleting a user is the app's own, never this module's.
 */
export interface AuthzDirectoryUser {
  id: string;
  /** What the console shows. */
  name: string;
  email?: string | null;
  /** The user's tenant; `null` for platform staff. */
  tenantId: string | null;
}

export interface AuthzDirectoryQuery {
  /** Only this tenant's users; `null` = platform staff (no tenant); omitted = everyone. */
  tenantId?: string | null;
  /** Matches name or email, case-insensitively. */
  search?: string;
  limit: number;
  /** Opaque — the previous page's `nextCursor`; the implementation decides its shape. */
  cursor?: string;
}

export interface AuthzDirectoryPage {
  users: AuthzDirectoryUser[];
  nextCursor?: string;
}

export interface AuthzUserDirectory {
  /** One page of users, ordered by name. Throws `InvalidDirectoryCursorError` for a cursor it never issued. */
  listUsers(query: AuthzDirectoryQuery): Promise<AuthzDirectoryPage>;
  /** These users — unknown ids are left out. */
  getUsers(ids: readonly string[]): Promise<AuthzDirectoryUser[]>;
  /** How many users — in `tenantId` when given (`null` = platform staff). */
  countUsers(tenantId?: string | null): Promise<number>;
}

/** A directory cursor the implementation never issued — the `.api` answers 400. */
export class InvalidDirectoryCursorError extends Error {
  constructor(cursor: string) {
    super(`Unrecognized cursor "${cursor}"`);
    this.name = 'InvalidDirectoryCursorError';
  }
}
