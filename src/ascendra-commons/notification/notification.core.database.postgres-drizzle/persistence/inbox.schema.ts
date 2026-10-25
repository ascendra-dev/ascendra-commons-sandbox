import { sql } from 'drizzle-orm';
import { bigserial, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_notification_inbox` table — a user's in-app messages, written by the `in_app` channel, read
 * and marked by the user through the inbox endpoints. Source of truth for the columns — a change ships as the next
 * numbered file in `../migrations/`.
 */
export const notificationInbox = pgTable(
  'commons_notification_inbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    application: text('application').notNull(),
    tenantId: text('tenant_id'),
    userId: text('user_id').notNull(),
    notificationType: text('notification_type').notNull(),
    title: text('title'),
    body: text('body').notNull(),
    correlationId: text('correlation_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('commons_notification_inbox_user_idx').on(t.application, t.userId, t.createdAt.desc(), t.id.desc()),
    index('commons_notification_inbox_unread_idx')
      .on(t.application, t.userId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.readAt} is null`),
    index('commons_notification_inbox_created_idx').on(t.application, t.createdAt),
  ],
);
