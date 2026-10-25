import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { InboxItemInput, NotificationInbox } from '../../notification.core';
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidDeliveryCursorError,
  isDeliveryId,
  type InboxItem,
  type InboxPage,
  type InboxQuery,
  type NotificationInboxStore,
} from '../../notification.core.database';
import type { SqlExecutor } from '../persistence/sql-executor';
import { NOTIFICATION_ADMIN_APPLICATION_ID, NOTIFICATION_ADMIN_SQL_EXECUTOR } from '../tokens';

const MAX_TEXT = 256;
const MAX_BODY = 20_000;
const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * The in-app inbox for Postgres: the `NotificationInbox` the `in_app` channel delivers to, and the
 * `NotificationInboxStore` a user reads and marks their own items through. Every read and mark is one user in one
 * tenant — the actor — `application`-scoped.
 */
@Injectable()
export class PostgresNotificationInbox implements NotificationInbox, NotificationInboxStore {
  constructor(
    @Inject(NOTIFICATION_ADMIN_SQL_EXECUTOR) private readonly db: SqlExecutor,
    @Inject(NOTIFICATION_ADMIN_APPLICATION_ID) private readonly application: string,
  ) {}

  async deliver(item: InboxItemInput): Promise<string> {
    const clean = (v: string | null | undefined, max: number) => (v == null ? null : v.replaceAll('\u0000', '').slice(0, max));
    const { rows } = await this.db.execute<{ id: string | number }>(sql`
      insert into commons_notification_inbox (application, tenant_id, user_id, notification_type, title, body, correlation_id)
      values (
        ${this.application}, ${item.tenantId}, ${item.userId}, ${clean(item.notificationType, MAX_TEXT)},
        ${clean(item.title, MAX_TEXT)}, ${clean(item.body, MAX_BODY) ?? ''},
        ${item.correlationId && CORRELATION_ID.test(item.correlationId) ? item.correlationId : null}
      )
      returning id
    `);
    return String(rows[0].id);
  }

  async list(userId: string, tenantId: string | null, query: InboxQuery): Promise<InboxPage> {
    const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
    const conds = [this.mine(userId, tenantId)];
    if (query.unreadOnly) conds.push(sql`read_at is null`);
    if (query.cursor) {
      const cursor = decodeKeysetCursor(query.cursor);
      if (!cursor) throw new InvalidDeliveryCursorError(`Unrecognized cursor "${query.cursor}"`);
      const ts = sql`${cursor.timestamp}::timestamptz`;
      conds.push(sql`created_at <= ${ts} and (created_at < ${ts} or id < ${cursor.id}::bigint)`);
    }
    const { rows } = await this.db.execute<InboxRow & { created_at_key: string }>(sql`
      select id, notification_type, title, body, created_at, read_at,
             to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_key
      from commons_notification_inbox
      where ${sql.join(conds, sql` and `)}
      order by created_at desc, id desc
      limit ${limit + 1}
    `);
    if (rows.length > limit) {
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { items: page.map(toItem), nextCursor: encodeKeysetCursor(String(last.created_at_key), String(last.id)) };
    }
    return { items: rows.map(toItem) };
  }

  async unreadCount(userId: string, tenantId: string | null): Promise<number> {
    const { rows } = await this.db.execute<{ n: number }>(sql`
      select count(*)::int as n from commons_notification_inbox where ${this.mine(userId, tenantId)} and read_at is null
    `);
    return Number(rows[0]?.n ?? 0);
  }

  async markRead(userId: string, tenantId: string | null, id: string): Promise<boolean> {
    if (!isDeliveryId(id)) return false;
    const { rows } = await this.db.execute(sql`
      update commons_notification_inbox set read_at = coalesce(read_at, now())
      where ${this.mine(userId, tenantId)} and id = ${id}::bigint
      returning id
    `);
    return rows.length > 0;
  }

  async markAllRead(userId: string, tenantId: string | null): Promise<number> {
    const { rows } = await this.db.execute(sql`
      update commons_notification_inbox set read_at = now()
      where ${this.mine(userId, tenantId)} and read_at is null
      returning id
    `);
    return rows.length;
  }

  /** One user's items in one tenant — never anyone else's. */
  private mine(userId: string, tenantId: string | null): SQL {
    return sql`application = ${this.application} and user_id = ${userId} and ${tenantId === null ? sql`tenant_id is null` : sql`tenant_id = ${tenantId}`}`;
  }
}

interface InboxRow {
  id: string | number;
  notification_type: string;
  title: string | null;
  body: string;
  created_at: string | Date;
  read_at: string | Date | null;
}

function toItem(r: InboxRow): InboxItem {
  const asDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));
  return {
    id: String(r.id),
    notificationType: r.notification_type,
    title: r.title,
    body: r.body,
    createdAt: asDate(r.created_at),
    readAt: r.read_at == null ? null : asDate(r.read_at),
  };
}
