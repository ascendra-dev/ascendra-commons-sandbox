import { bigserial, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

/**
 * The reference `commons_notification_suppression` table — recipients a channel stops sending to (a hard bounce, a
 * complaint), filed by the provider webhook through the delivery recorder, read by `PostgresNotificationSuppressionList`
 * on each send. Keyed like the delivery log: `user:<id>` or the keyed hash of an address. Source of truth for the
 * columns — a change ships as the next numbered file in `../migrations/`.
 */
export const notificationSuppression = pgTable(
  'commons_notification_suppression',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    application: text('application').notNull(),
    channel: text('channel').notNull(),
    recipientKey: text('recipient_key').notNull(),
    tenantId: text('tenant_id'),
    reason: text('reason').notNull(),
    detail: text('detail'),
    firstAt: timestamp('first_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastAt: timestamp('last_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    eventCount: integer('event_count').notNull().default(1),
  },
  (t) => [
    unique('commons_notification_suppression_uq').on(t.application, t.channel, t.recipientKey),
    index('commons_notification_suppression_list_idx').on(t.application, t.lastAt.desc(), t.id.desc()),
    index('commons_notification_suppression_tenant_idx').on(t.application, t.tenantId, t.lastAt.desc(), t.id.desc()),
  ],
);
