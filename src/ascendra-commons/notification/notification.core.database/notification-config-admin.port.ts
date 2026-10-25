import type { NotificationChannel } from '../notification.core';
import type {
  ChannelRouteView,
  ConfigScope,
  DeleteChannelRouteInput,
  DeleteProviderCredentialInput,
  DeleteTemplateInput,
  ProviderCredentialView,
  SetChannelRouteInput,
  SetProviderCredentialInput,
  SetTemplateInput,
  SuppressionListQuery,
  SuppressionPage,
  SuppressionView,
  TemplateView,
} from './notification-admin.types';

/**
 * CRUD on the routing / template / provider-credential config for a notification
 * admin screen. Bound under `NOTIFICATION_CONFIG_ADMIN_PORT` by a stack adapter;
 * consumed by `notification.api`.
 *
 * `tenantId` NULL = the deployment default (platform-admin territory in
 * `notification.api`). A `scope` narrows a list to the defaults plus one tenant's rows. Provider-credential *values* are never returned by
 * `listProviderCredentials` — they hold secrets. Audit is `notification.api`'s
 * to wire.
 */
export interface NotificationConfigAdminPort {
  /** One route row as stored (`tenantId` NULL = the default row) — `null` when there is none. */
  getChannelRoute(notificationType: string, tenantId: string | null): Promise<ChannelRouteView | null>;
  setChannelRoute(input: SetChannelRouteInput): Promise<void>;
  deleteChannelRoute(input: DeleteChannelRouteInput): Promise<void>;
  listChannelRoutes(scope?: ConfigScope): Promise<ChannelRouteView[]>;

  /** One template row as stored — `null` when there is none. */
  getTemplate(channel: NotificationChannel, notificationType: string, tenantId: string | null): Promise<TemplateView | null>;
  setTemplate(input: SetTemplateInput): Promise<void>;
  deleteTemplate(input: DeleteTemplateInput): Promise<void>;
  listTemplates(scope?: ConfigScope): Promise<TemplateView[]>;

  /** Whether a credential row exists for this channel and tenant — its value is never read here. */
  hasProviderCredential(channel: NotificationChannel, tenantId: string | null): Promise<boolean>;
  setProviderCredential(input: SetProviderCredentialInput): Promise<void>;
  deleteProviderCredential(input: DeleteProviderCredentialInput): Promise<void>;
  listProviderCredentials(scope?: ConfigScope): Promise<ProviderCredentialView[]>;

  /**
   * The suppression list, newest first. An entry applies to the whole app (a dead address is dead for every tenant);
   * `scope` narrows it to the entries that tenant is affected by — filed under it, or for a recipient it has sent to on
   * that channel.
   */
  listSuppressions(query: SuppressionListQuery, scope?: ConfigScope): Promise<SuppressionPage>;
  /** One entry — `null` when it doesn't exist, or `scope`'s tenant isn't affected by it. */
  getSuppression(id: string, scope?: ConfigScope): Promise<SuppressionView | null>;
  /** Removes one entry — the recipient is sent to again (at once in this process). */
  deleteSuppression(id: string): Promise<void>;
}
