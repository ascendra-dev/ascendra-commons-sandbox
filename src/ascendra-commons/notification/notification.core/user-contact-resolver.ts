import { Injectable } from '@nestjs/common';

/**
 * Resolves contact info for a 'user' recipient. A consuming project implements
 * this against its own actual user/issuer/staff table — this library has no
 * opinion on that schema. Returns both fields regardless of which channel is
 * asking; each sender picks the one it needs (email for EmailNotificationSender,
 * phone for SMSNotificationSender) — one resolver, reused by both, since
 * resolving "this user's contact info" is one concern, not two.
 */
export interface UserContactResolver {
  /**
   * `tenantId` is optional: when the resolver reports it, `notification.api`'s test send lets a tenant admin pick a
   * colleague in their own tenant; when it doesn't, a tenant admin may test-send to themselves only.
   */
  findById(id: string): Promise<{ email?: string; phone?: string; tenantId?: string | null } | null>;
}

/**
 * The default bound by NotificationModule.forRoot() — every 'user' recipient
 * resolves to "no match," which each sender already turns into a clean
 * 'no_address_available' failure rather than a crash. This keeps forRoot()
 * usable out of the box for a project that only ever uses 'raw' recipients
 * (e.g. guest/payer links), without requiring a real user-table binding until
 * 'user' recipients are actually needed.
 */
@Injectable()
export class NullUserContactResolver implements UserContactResolver {
  async findById(): Promise<{ email?: string; phone?: string; tenantId?: string | null } | null> {
    return null;
  }
}
