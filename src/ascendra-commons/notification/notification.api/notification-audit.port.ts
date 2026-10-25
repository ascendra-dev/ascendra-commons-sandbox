import { Injectable } from '@nestjs/common';

/**
 * Where `notification.api` sends an audit record after each config mutation, and after each read of a delivery's
 * stored content.
 * Optional: bind `NOTIFICATION_AUDIT_EMITTER` (e.g. to an adapter over
 * `audit-logging`) and every route/template/credential edit is recorded; leave
 * it unbound and the no-op is used. `notification.api` takes **no** dependency
 * on `audit-logging`.
 */
export interface NotificationAuditEvent {
  /**
   * e.g. `'notification.route_set'`, `'notification.template_deleted'`, `'notification.credential_set'` — and one read,
   * `'notification.content_viewed'`: someone read a delivery's stored message.
   */
  action: string;
  actorId: string;
  tenantId: string | null;
  /** `'channel_route'` | `'template'` | `'provider_credential'` | `'delivery'`. */
  entityType: string;
  /** A stable id for the row — e.g. `'invoice.sent'` or `'email:invoice.sent:t1'`. */
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export interface NotificationAuditEmitter {
  record(event: NotificationAuditEvent): Promise<void> | void;
}

/** The default binding — audit is opt-in. */
@Injectable()
export class NoopNotificationAuditEmitter implements NotificationAuditEmitter {
  record(): void {
    /* no-op */
  }
}
