import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The sandbox's users — what a product's own users table (or identity provider) holds. authorization knows only
 * opaque ids; its console reads names and tenants through the AuthzUserDirectory port, which src/demo/demo-users.ts
 * implements over this table. Dev sign-in (POST /dev/token) can sign in as any of them.
 */
export const demoUser = pgTable(
  'demo_user',
  {
    /** Looks like an email — the id the audit log records and the console shows. */
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    /** `null` for platform staff. */
    tenantId: text('tenant_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // The directory's list: one tenant's users by name (keyset on name, id).
    index('demo_user_tenant_name_idx').on(table.tenantId, table.name, table.id),
    index('demo_user_name_idx').on(table.name, table.id),
  ],
);
