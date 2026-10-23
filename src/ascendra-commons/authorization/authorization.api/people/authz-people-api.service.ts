import { Inject, Injectable, NotFoundException, NotImplementedException, Optional } from '@nestjs/common';
import type { Actor } from '../../authorization.core';
import {
  AUTHZ_OBSERVABILITY_PORT,
  type AccessExplanation,
  type AccessStats,
  type AuthzObservabilityPort,
  type DelegationView,
  type UserRoleAssignment,
} from '../../authorization.core.permission-table';
import { AuthzAccessScope } from '../shared/access-scope';
import { mapErrors } from '../shared/errors';
import { cursorList, idParam, positiveIntParam, textParam } from '../shared/params';
import { AUTHZ_USER_DIRECTORY } from '../tokens';
import type { AuthzDirectoryUser, AuthzUserDirectory } from './user-directory.port';

const DEFAULT_USER_LIMIT = 50;
const MAX_USER_LIMIT = 200;
/** A person's ledger rows on their profile — the full history is the assignment and delegation lists. */
const PROFILE_ROWS = 100;

/** A user in a list, with the roles they actively hold where the viewer can see. */
export interface PersonRow extends AuthzDirectoryUser {
  roles: Array<Pick<UserRoleAssignment, 'roleId' | 'tenantId' | 'expiresAt'>>;
}

/** One person's access, as the viewer may see it. */
export interface PersonProfile {
  user: AuthzDirectoryUser;
  /** Every assignment (active and expired) the viewer can see — their tenant's and the global ones. */
  assignments: UserRoleAssignment[];
  /** Delegations they lent or were lent, newest first. */
  delegations: DelegationView[];
  /** What they can do in their own tenant (globally for platform staff), and through what. */
  access: AccessExplanation;
}

/** Users the people endpoints know nothing about without a directory. */
const NO_DIRECTORY =
  'No user directory is wired — bind an AuthzUserDirectory and pass userDirectoryToken to AuthorizationApiModule.forRoot().';

/**
 * People — the app's users (from its `AuthzUserDirectory`) joined to their access. A tenant admin sees its own
 * tenant's users (plus the names of platform staff, who act in every tenant); a platform admin sees everyone. A user
 * outside the viewer's reach is a 404, never a 403 — whether they exist isn't the viewer's to learn.
 */
@Injectable()
export class AuthzPeopleApiService {
  constructor(
    @Inject(AUTHZ_OBSERVABILITY_PORT) private readonly port: AuthzObservabilityPort,
    @Inject(AuthzAccessScope) private readonly scope: AuthzAccessScope,
    @Optional() @Inject(AUTHZ_USER_DIRECTORY) private readonly directory?: AuthzUserDirectory,
  ) {}

  /** One page of users by name, each with their active roles. */
  async listUsers(actor: Actor, query: { tenantId?: string; search?: string; limit?: string; cursor?: string }) {
    const directory = this.requireDirectory();
    const tenantId = await this.scope.readTenant(actor, idParam('tenantId', query.tenantId, true));
    const page = await mapErrors(() =>
      directory.listUsers({
        tenantId,
        search: textParam('search', query.search, 200) || undefined,
        limit: Math.min(positiveIntParam('limit', query.limit) ?? DEFAULT_USER_LIMIT, MAX_USER_LIMIT),
        cursor: query.cursor,
      }),
    );
    const ids = page.users.map((u) => u.id);
    const { assignments } =
      ids.length === 0
        ? { assignments: [] as UserRoleAssignment[] }
        : await this.port.listUserRoleAssignments({ userIds: ids, tenantId, status: 'active', limit: 500 });
    const rows: PersonRow[] = page.users.map((user) => ({
      ...user,
      roles: assignments
        .filter((a) => a.userId === user.id && (a.tenantId === null || a.tenantId === user.tenantId))
        .map(({ roleId, tenantId: t, expiresAt }) => ({ roleId, tenantId: t, expiresAt })),
    }));
    return cursorList(rows, page.nextCursor);
  }

  /** Names for ids — what a list of assignments or delegations shows. Ids outside the viewer's reach are left out. */
  async lookup(actor: Actor, idsParam: string | undefined): Promise<AuthzDirectoryUser[]> {
    const directory = this.requireDirectory();
    const ids = [...new Set((idsParam ?? '').split(',').map((id) => id.trim()).filter(Boolean))].slice(0, 200);
    ids.forEach((id, i) => idParam(`ids[${i}]`, id));
    if (ids.length === 0) return [];
    const users = await directory.getUsers(ids);
    if (await this.scope.isPlatform(actor)) return users;
    return users.filter((u) => u.tenantId === actor.tenantId || u.tenantId === null);
  }

  /** One person: who they are, every role they were given, what they lent and were lent, and what they can do now. */
  async profile(actor: Actor, idValue: string): Promise<PersonProfile> {
    const directory = this.requireDirectory();
    const id = idParam('id', idValue);
    const [user] = await directory.getUsers([id]);
    const platform = await this.scope.isPlatform(actor);
    if (!user || (!platform && user.tenantId !== actor.tenantId)) throw new NotFoundException(`No user "${id}"`);

    const tenantId = platform ? undefined : actor.tenantId!;
    const [assignmentPage, delegationPage, access] = await Promise.all([
      this.port.listUserRoleAssignments({ userId: id, tenantId, limit: PROFILE_ROWS }),
      this.port.listDelegations({ userId: id, tenantId, limit: PROFILE_ROWS }),
      this.port.explainAccess(id, user.tenantId),
    ]);
    // A tenant admin also sees the global roles reaching its tenant — they're part of this user's access there.
    const assignments = platform
      ? assignmentPage.assignments
      : [
          ...assignmentPage.assignments,
          ...(await this.port.listUserRoleAssignments({ userId: id, tenantId: null, limit: PROFILE_ROWS })).assignments,
        ];
    return { user, assignments, delegations: delegationPage.delegations, access };
  }

  /** The Overview's posture — users with and without a role, who holds what, delegations to watch. */
  async stats(actor: Actor, requestedTenant: string | undefined): Promise<AccessStats & { users: number | null; usersWithoutRole: number | null }> {
    const tenantId = await this.scope.readTenant(actor, idParam('tenantId', requestedTenant, true));
    const stats = await this.port.accessStats(tenantId);
    const users = this.directory ? await this.directory.countUsers(tenantId) : null;
    return { ...stats, users, usersWithoutRole: users === null ? null : Math.max(0, users - stats.usersWithRole) };
  }

  private requireDirectory(): AuthzUserDirectory {
    if (!this.directory) throw new NotImplementedException(NO_DIRECTORY);
    return this.directory;
  }
}
