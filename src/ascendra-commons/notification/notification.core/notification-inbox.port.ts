/** One message for a user's in-app inbox, as `InAppNotificationSender` writes it. */
export interface InboxItemInput {
  userId: string;
  tenantId: string | null;
  notificationType: string;
  /** The template's `subject` — the line the inbox lists. */
  title: string | null;
  body: string;
  correlationId?: string;
}

/**
 * Where the `in_app` channel delivers — a user's inbox in the app itself (the bell, the "notifications" page).
 * Optional: bound via `NotificationModule.forRoot({ inboxToken })`; without it, an `in_app` route fails `no_inbox`.
 * Returns the stored item's id.
 */
export interface NotificationInbox {
  deliver(item: InboxItemInput): Promise<string>;
}
