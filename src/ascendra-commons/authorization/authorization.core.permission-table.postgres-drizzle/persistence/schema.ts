import { bigserial, boolean, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_authz_*` schema — one concrete Postgres/Drizzle shape of the
 * database-backed authorization model (Model 2). Source of truth for the
 * columns — a change ships as the next numbered file in `../migrations/` (never
 * an edit to a released one).
 *
 * A consuming project never re-exports these into the schema files
 * `drizzle-kit` reads — the DDL comes from `../migrations/`; a project on
 * another stack ignores this folder and provides its own `Authorizer`.
 *
 * Tables are `commons_authz_`-prefixed on purpose — `role` / `user_role` are
 * names a vertical is likely to want for its own tables, and the `commons_`
 * prefix groups every vendored table (see this repo's other adapters).
 */

/** The role catalog — platform-owned, small, not tenant-editable. */
export const authzRole = pgTable('commons_authz_role', {
  /** Stable slug (`'issuer'`, `'issuer_owner'`), not a uuid — referenced from seeds and the admin matrix. */
  id: text('id').primaryKey(),
  description: text('description'),
  /** The `'*'` wildcard equivalent — this role grants every action, no `commons_authz_role_permission` rows needed. */
  grantsAll: boolean('grants_all').notNull().default(false),
});

/**
 * The action catalog. `name` is the key from the app's `Actions` const, kept in
 * sync by `syncActions()`. `description` ships empty and is filled in later
 * through the admin UI — never set by the sync.
 */
export const authzAction = pgTable('commons_authz_action', {
  name: text('name').primaryKey(),
  description: text('description'),
  /** 'platform' | 'tenant' — where a role granting it may be assigned (migration 0002). */
  scope: text('scope').notNull().default('tenant'),
});

/** Which actions each role grants. Ignored when the role's `grants_all` is true. */
export const authzRolePermission = pgTable(
  'commons_authz_role_permission',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => authzRole.id, { onDelete: 'cascade' }),
    /** FK to the action catalog — `onDelete: 'restrict'` forces deliberate cleanup before an action can be removed. */
    action: text('action')
      .notNull()
      .references(() => authzAction.name, { onDelete: 'restrict' }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.action] })],
);

/**
 * Role assignments. Tenant-scoped: the same user can hold different roles in
 * different tenants. `tenant_id` NULL = the role applies in every tenant / in a
 * no-tenant context (a platform admin).
 */
export const authzUserRole = pgTable(
  'commons_authz_user_role',
  {
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id'),
    roleId: text('role_id')
      .notNull()
      .references(() => authzRole.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    grantedBy: text('granted_by'),
    /** When the role stops applying; null = no expiry (migration 0002). */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    // NULLS NOT DISTINCT so (user, NULL, role) can't be double-inserted (Postgres 15+).
    unique('commons_authz_user_role_uq').on(table.userId, table.tenantId, table.roleId).nullsNotDistinct(),
    index('commons_authz_user_role_lookup').on(table.userId, table.tenantId),
    index('commons_authz_user_role_tenant_idx').on(table.tenantId, table.grantedAt.desc()),
    index('commons_authz_user_role_role_idx').on(table.roleId, table.tenantId),
  ],
);

/**
 * Delegations — a user granting a subset of their own (role-derived) actions to
 * another user, within one tenant. Snapshot model: `actions` is fixed at grant
 * time and stays valid until `expires_at` (mandatory) or `revoked_at`. See the
 * adapter README for what the snapshot model defers.
 */
export const authzDelegation = pgTable(
  'commons_authz_delegation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    granterId: text('granter_id').notNull(),
    granteeId: text('grantee_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    actions: text('actions').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedBy: text('revoked_by'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdBy: text('created_by').notNull(),
  },
  (table) => [
    index('commons_authz_delegation_grantee').on(table.granteeId, table.tenantId),
    index('commons_authz_delegation_list_idx').on(table.createdAt.desc(), table.id.desc()),
    index('commons_authz_delegation_tenant_idx').on(table.tenantId, table.createdAt.desc(), table.id.desc()),
    index('commons_authz_delegation_granter_idx').on(table.granterId, table.tenantId),
  ],
);

/** The denied-requests log — one row per actor, action, route, method and minute (migrations 0003–0004). */
export const authzDenial = pgTable(
  'commons_authz_denial',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    application: text('application').notNull(),
    actorId: text('actor_id').notNull(),
    tenantId: text('tenant_id'),
    action: text('action').notNull(),
    method: text('method').notNull(),
    route: text('route').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true, mode: 'date' }).notNull(),
    denialCount: integer('denial_count').notNull(),
    firstDeniedAt: timestamp('first_denied_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastDeniedAt: timestamp('last_denied_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** The latest denied request's correlation id in the window — a sample to trace, not part of the key. */
    correlationId: text('correlation_id'),
  },
  (table) => [
    unique('commons_authz_denial_window_uq')
      .on(table.application, table.actorId, table.tenantId, table.action, table.method, table.route, table.windowStart)
      .nullsNotDistinct(),
    index('commons_authz_denial_list_idx').on(table.application, table.windowStart.desc(), table.id.desc()),
    index('commons_authz_denial_tenant_idx').on(table.application, table.tenantId, table.windowStart.desc(), table.id.desc()),
    index('commons_authz_denial_actor_idx').on(table.application, table.actorId, table.windowStart.desc(), table.id.desc()),
  ],
);
