/** One item in a user's in-app inbox. */
export interface InboxItem {
  id: string;
  notificationType: string;
  title: string | null;
  body: string;
  createdAt: Date;
  /** `null` — unread. */
  readAt: Date | null;
}

export interface InboxQuery {
  unreadOnly?: boolean;
  /** Default 20, capped at 100. */
  limit?: number;
  cursor?: string;
}

export interface InboxPage {
  items: InboxItem[];
  nextCursor?: string;
}

/**
 * A user's in-app inbox, as `notification.api`'s inbox endpoints read and mark it — always one user in one tenant (the
 * request's actor), never anyone else's. Bound under `NOTIFICATION_INBOX_STORE` by a stack adapter (which also
 * implements the core `NotificationInbox` the `in_app` channel delivers to).
 */
export interface NotificationInboxStore {
  list(userId: string, tenantId: string | null, query: InboxQuery): Promise<InboxPage>;
  unreadCount(userId: string, tenantId: string | null): Promise<number>;
  /** `false` when it isn't this user's item (or doesn't exist). */
  markRead(userId: string, tenantId: string | null, id: string): Promise<boolean>;
  /** How many were marked. */
  markAllRead(userId: string, tenantId: string | null): Promise<number>;
}
