import { boolean, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_notification_preference` table — a user's rules: a type (or `'*'`) on a channel (or `'*'`),
 * enabled or not. Read on each send to a user (cached), edited through "my preferences". Source of truth for the
 * columns — a change ships as the next numbered file in `../migrations/`.
 */
export const notificationPreference = pgTable(
  'commons_notification_preference',
  {
    application: text('application').notNull(),
    userId: text('user_id').notNull(),
    notificationType: text('notification_type').notNull(),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.application, t.userId, t.notificationType, t.channel] })],
);
