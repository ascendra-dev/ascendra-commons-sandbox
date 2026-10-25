import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import { NOTIFICATION_CHANNELS, type NotificationChannel } from '../../notification.core';
import {
  ANY,
  NOTIFICATION_CONFIG_ADMIN_PORT,
  NOTIFICATION_PREFERENCE_STORE,
  preferenceAllows,
  type NotificationConfigAdminPort,
  type NotificationPreferenceStore,
  type PreferenceRule,
} from '../../notification.core.database';
import { booleanParam, idParam } from '../shared/params';
import { NotificationTypeCatalog } from '../types/notification-type-catalog';

/** "My notifications" — each declared type, the channels it reaches this user on, and whether each is on. */
export interface MyPreferences {
  rules: PreferenceRule[];
  types: Array<{
    name: string;
    description: string | null;
    audience: string | null;
    /** Always sent — can't be turned off. */
    required: boolean;
    channels: Array<{ channel: NotificationChannel; enabled: boolean }>;
  }>;
}

/**
 * A signed-in user's own notification preferences — no admin action needed, and only ever their own (the user is the
 * request's actor, never a parameter). A `required` type can't be turned off.
 */
@Injectable()
export class NotificationPreferencesApiService {
  constructor(
    @Inject(NOTIFICATION_CONFIG_ADMIN_PORT) private readonly config: NotificationConfigAdminPort,
    @Inject(NotificationTypeCatalog) private readonly types: NotificationTypeCatalog,
    @Optional() @Inject(NOTIFICATION_PREFERENCE_STORE) private readonly store?: NotificationPreferenceStore,
  ) {}

  async mine(actor: Actor): Promise<MyPreferences> {
    const store = this.requireStore();
    const rules = await store.listRules(actor.id);
    const types = await Promise.all(
      this.types.list().map(async (type) => {
        // The channels this type reaches this user on: their tenant's route, else the default.
        const route =
          (actor.tenantId ? await this.config.getChannelRoute(type.name, actor.tenantId) : null) ??
          (await this.config.getChannelRoute(type.name, null));
        return {
          name: type.name,
          description: type.description ?? null,
          audience: type.audience ?? null,
          required: type.required === true,
          channels: (route?.channels ?? []).map((channel) => ({
            channel,
            enabled: type.required === true || preferenceAllows(rules, type.name, channel),
          })),
        };
      }),
    );
    return { rules, types };
  }

  async set(actor: Actor, body: { notificationType?: unknown; channel?: unknown; enabled?: unknown }): Promise<void> {
    const store = this.requireStore();
    const notificationType = idParam('notificationType', body?.notificationType);
    if (notificationType !== ANY) {
      this.types.assertKnown(notificationType);
      if (this.types.get(notificationType)?.required) {
        throw new BadRequestException(`"${notificationType}" is always sent — it can't be turned off`);
      }
    }
    const channel = idParam('channel', body?.channel);
    if (channel !== ANY && !(NOTIFICATION_CHANNELS as readonly string[]).includes(channel)) {
      throw new BadRequestException(`"channel" must be one of ${NOTIFICATION_CHANNELS.join(', ')} or *`);
    }
    const enabled = booleanParam('enabled', body?.enabled);
    if (enabled === undefined) throw new BadRequestException('"enabled" is required — true or false');
    await store.setRule(actor.id, { notificationType, channel: channel as PreferenceRule['channel'], enabled });
  }

  private requireStore(): NotificationPreferenceStore {
    if (!this.store) throw new NotFoundException('notification preferences are not enabled in this app');
    return this.store;
  }
}
