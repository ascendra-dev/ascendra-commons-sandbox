import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import type { NotificationChannel, NotificationVariableDefinition } from '../../notification.core';
import {
  NOTIFICATION_CONFIG_ADMIN_PORT,
  NOTIFICATION_OBSERVABILITY_PORT,
  type ChannelRouteView,
  type ConfigScope,
  type CoverageGap,
  type NotificationConfigAdminPort,
  type NotificationObservabilityPort,
  type TemplateView,
} from '../../notification.core.database';
import { NOTIFICATION_API_OPTIONS, NOTIFICATION_TENANT_DIRECTORY } from '../tokens';
import type { NotificationTenantDirectory } from '../notification-tenant-directory.port';
import type { NotificationApiOptions } from '../notification-api.options';
import { idParam } from '../shared/params';
import { NotificationTypeCatalog } from './notification-type-catalog';

/** One row of the Notification types list. */
export interface NotificationTypeSummary {
  name: string;
  /** In the app's `forRoot({ types })` — `false` for a type that has config but isn't declared (a leftover, a typo). */
  declared: boolean;
  description: string | null;
  audience: string | null;
  /** Always sent — a user can't turn it off in their preferences. */
  required: boolean;
  variables: NotificationVariableDefinition[];
  /** The deployment default's channels — `null` when there's no default route. */
  defaultChannels: NotificationChannel[] | null;
  /** Tenant routes the actor may see (a tenant admin: their own, at most one). */
  tenantRoutes: number;
  /** Which (channel, tenant) templates exist — `tenantId` null is the default. */
  templates: Array<{ channel: NotificationChannel; tenantId: string | null }>;
  /** Coverage gaps for this type, in what the actor may see. */
  gaps: number;
}

/** A type's page: its definition, every route and template the actor may see, and its gaps. */
export interface NotificationTypeDetail extends Omit<NotificationTypeSummary, 'tenantRoutes' | 'templates' | 'gaps'> {
  routes: ChannelRouteView[];
  templates: TemplateView[];
  gaps: CoverageGap[];
}

/**
 * `GET /notifications/types` and `/types/:name` — the declared types joined with the configuration that serves them,
 * scoped like every config read (a tenant admin: the defaults plus their own tenant).
 */
@Injectable()
export class NotificationTypesApiService {
  constructor(
    @Inject(NOTIFICATION_CONFIG_ADMIN_PORT) private readonly config: NotificationConfigAdminPort,
    @Inject(NOTIFICATION_OBSERVABILITY_PORT) private readonly observability: NotificationObservabilityPort,
    @Inject(NOTIFICATION_API_OPTIONS) private readonly options: NotificationApiOptions,
    @Inject(NotificationTypeCatalog) private readonly catalog: NotificationTypeCatalog,
    @Optional() @Inject(NOTIFICATION_TENANT_DIRECTORY) private readonly tenants?: NotificationTenantDirectory,
  ) {}

  async list(actor: Actor): Promise<NotificationTypeSummary[]> {
    const { routes, templates, gaps } = await this.load(actor);
    const names = new Set([...this.catalog.list().map((t) => t.name), ...routes.map((r) => r.notificationType), ...templates.map((t) => t.notificationType)]);
    return [...names].sort().map((name) => {
      const own = (r: { notificationType: string }) => r.notificationType === name;
      return {
        ...this.definition(name),
        defaultChannels: routes.find((r) => own(r) && r.tenantId === null)?.channels ?? null,
        tenantRoutes: routes.filter((r) => own(r) && r.tenantId !== null).length,
        templates: templates.filter(own).map((t) => ({ channel: t.channel, tenantId: t.tenantId })),
        gaps: gaps.filter(own).length,
      };
    });
  }

  async detail(actor: Actor, rawName: string): Promise<NotificationTypeDetail> {
    const name = idParam('name', rawName);
    const { routes, templates, gaps } = await this.load(actor);
    const own = (r: { notificationType: string }) => r.notificationType === name;
    const typeRoutes = routes.filter(own);
    const typeTemplates = templates.filter(own);
    if (!this.catalog.get(name) && typeRoutes.length === 0 && typeTemplates.length === 0) {
      throw new NotFoundException('no such notification type');
    }
    return {
      ...this.definition(name),
      defaultChannels: typeRoutes.find((r) => r.tenantId === null)?.channels ?? null,
      routes: typeRoutes,
      templates: typeTemplates,
      gaps: gaps.filter(own),
    };
  }

  private definition(name: string) {
    const type = this.catalog.get(name);
    return {
      name,
      declared: type !== undefined,
      description: type?.description ?? null,
      audience: type?.audience ?? null,
      required: type?.required === true,
      variables: type?.variables ?? [],
    };
  }

  private async load(actor: Actor) {
    const scope = await this.scopeOf(actor);
    const [routes, templates, gaps] = await Promise.all([
      this.config.listChannelRoutes(scope),
      this.config.listTemplates(scope),
      this.observability.configCoverageGaps(scope, scope ? undefined : await this.tenants?.listTenantIds()),
    ]);
    return { routes, templates, gaps };
  }

  private async scopeOf(actor: Actor): Promise<ConfigScope | undefined> {
    if (await this.options.isPlatformAdmin(actor)) return undefined;
    return { tenantId: actor.tenantId ?? '' };
  }
}
