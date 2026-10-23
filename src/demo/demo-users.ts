import { Inject, Injectable, Module } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  InvalidDirectoryCursorError,
  type AuthzDirectoryPage,
  type AuthzDirectoryQuery,
  type AuthzDirectoryUser,
  type AuthzUserDirectory,
} from '../ascendra-commons/authorization/authorization.api';
import { DATABASE_CONNECTION, DatabaseModule, type Database } from '../db/database.module';

interface UserRow {
  id: string;
  name: string;
  email: string;
  tenant_id: string | null;
}

const toUser = (r: UserRow): AuthzDirectoryUser => ({ id: r.id, name: r.name, email: r.email, tenantId: r.tenant_id });

/**
 * authorization's `AuthzUserDirectory` over the sandbox's `demo_user` table — what a product implements over its own
 * users table or identity provider. Users by name, keyset on (name, id), case-insensitive search on name or email.
 */
@Injectable()
export class DemoUserDirectory implements AuthzUserDirectory {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async listUsers(query: AuthzDirectoryQuery): Promise<AuthzDirectoryPage> {
    const conds: SQL[] = [];
    if (query.tenantId !== undefined) conds.push(query.tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${query.tenantId}`);
    if (query.search) {
      const like = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conds.push(sql`(name ilike ${like} or email ilike ${like})`);
    }
    if (query.cursor) {
      const cursor = decode(query.cursor);
      if (!cursor) throw new InvalidDirectoryCursorError(query.cursor);
      conds.push(sql`(name, id) > (${cursor.name}, ${cursor.id})`);
    }
    const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
    const { rows } = await this.db.execute(sql`
      select id, name, email, tenant_id from demo_user ${where} order by name, id limit ${query.limit + 1}
    `);
    const users = (rows as unknown as UserRow[]).map(toUser);
    if (users.length <= query.limit) return { users };
    const page = users.slice(0, query.limit);
    const last = page[page.length - 1];
    return { users: page, nextCursor: Buffer.from(JSON.stringify({ name: last.name, id: last.id })).toString('base64url') };
  }

  async getUsers(ids: readonly string[]): Promise<AuthzDirectoryUser[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.execute(sql`
      select id, name, email, tenant_id from demo_user
      where id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      order by name, id
    `);
    return (rows as unknown as UserRow[]).map(toUser);
  }

  async countUsers(tenantId?: string | null): Promise<number> {
    const where = tenantId === undefined ? sql`` : tenantId === null ? sql`where tenant_id is null` : sql`where tenant_id = ${tenantId}`;
    const { rows } = await this.db.execute(sql`select count(*)::int as n from demo_user ${where}`);
    return Number((rows[0] as { n: number }).n);
  }

  /** One user — dev sign-in's lookup. */
  async find(id: string): Promise<AuthzDirectoryUser | null> {
    return (await this.getUsers([id]))[0] ?? null;
  }
}

function decode(cursor: string): { name: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { name?: unknown; id?: unknown };
    return typeof parsed.name === 'string' && typeof parsed.id === 'string' ? { name: parsed.name, id: parsed.id } : null;
  } catch {
    return null;
  }
}

@Module({ imports: [DatabaseModule], providers: [DemoUserDirectory], exports: [DemoUserDirectory] })
export class DemoUsersModule {}
