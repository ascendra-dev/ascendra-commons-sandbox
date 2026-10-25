import type { NotificationChannel } from '../notification.core';

/** `'*'` — every type, or every channel. */
export const ANY = '*';

/** One of a user's rules — the most specific one matching a send wins: (type, channel) › (type, *) › (*, channel) › (*, *). */
export interface PreferenceRule {
  notificationType: string;
  channel: NotificationChannel | typeof ANY;
  enabled: boolean;
  updatedAt: Date;
}

/**
 * A user's notification preferences, as `notification.api`'s "my preferences" reads and edits them. Bound under
 * `NOTIFICATION_PREFERENCE_STORE` by a stack adapter (which also implements the core `NotificationPreferences` Notifier
 * asks on each send).
 */
export interface NotificationPreferenceStore {
  listRules(userId: string): Promise<PreferenceRule[]>;
  /** Upserts one rule; the next send sees it (the adapter clears its caches). */
  setRule(userId: string, rule: Omit<PreferenceRule, 'updatedAt'>): Promise<void>;
}

/** Whether a user's rules let (type, channel) through — the most specific matching rule wins; none: yes. */
export function preferenceAllows(rules: readonly Pick<PreferenceRule, 'notificationType' | 'channel' | 'enabled'>[], notificationType: string, channel: NotificationChannel): boolean {
  let best: { enabled: boolean; specificity: number } | null = null;
  for (const r of rules) {
    if ((r.notificationType !== notificationType && r.notificationType !== ANY) || (r.channel !== channel && r.channel !== ANY)) continue;
    const specificity = (r.notificationType === ANY ? 0 : 2) + (r.channel === ANY ? 0 : 1);
    if (!best || specificity > best.specificity) best = { enabled: r.enabled, specificity };
  }
  return best?.enabled ?? true;
}
