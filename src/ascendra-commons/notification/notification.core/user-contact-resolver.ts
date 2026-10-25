import { Injectable } from '@nestjs/common';

/**
 * Resolves contact info for a 'user' recipient. A consuming project implements
 * this against its own actual user/issuer/staff table — this library has no
 * opinion on that schema. Returns both fields regardless of which channel is
 * asking; each sender picks the one it needs (email for EmailNotificationSender,
 * phone for SMSNotificationSender) — one resolver, reused by both, since
 * resolving "this user's contact info" is one concern, not two.
 */
/** What the app knows about a user — the contact details a sender needs, and (optionally) what the console shows. */
export interface UserContact {
  email?: string;
  phone?: string;
  /**
   * Optional: when the resolver reports it, `notification.api`'s test send lets a tenant admin pick a colleague in
   * their own tenant; when it doesn't, a tenant admin may test-send to themselves only.
   */
  tenantId?: string | null;
  /** Optional: the console shows a user recipient by this name instead of their id. */
  name?: string;
}

export interface UserContactResolver {
  findById(id: string): Promise<UserContact | null>;
  /**
   * Optional — many users in one call, for the console naming a page of deliveries. Unknown ids are left out.
   * Without it, `notification.api` asks `findById` for each (at most a page's worth).
   */
  findByIds?(ids: readonly string[]): Promise<Array<UserContact & { id: string }>>;
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
  async findById(): Promise<UserContact | null> {
    return null;
  }
}
