import { index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_notification_dedupe` table — one row per claimed `dedupeKey`, holding the claimed call's
 * result for a duplicate to get back. Source of truth for the columns — a change ships as the next numbered file in
 * `../migrations/`.
 */
export const notificationDedupe = pgTable(
  'commons_notification_dedupe',
  {
    application: text('application').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    result: jsonb('result'),
  },
  (t) => [
    primaryKey({ columns: [t.application, t.dedupeKey] }),
    index('commons_notification_dedupe_expires_idx').on(t.application, t.expiresAt),
  ],
);
