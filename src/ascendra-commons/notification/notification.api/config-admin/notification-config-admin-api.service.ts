import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import {
  NOTIFICATION_CHANNELS,
  NOTIFIER,
  renderTemplate,
  type CredentialCheck,
  type NotificationChannel,
  type Notifier,
} from '../../notification.core';
import {
  NOTIFICATION_CONFIG_ADMIN_PORT,
  type ConfigScope,
  type NotificationConfigAdminPort,
} from '../../notification.core.database';
import { NOTIFICATION_API_OPTIONS, NOTIFICATION_AUDIT_EMITTER } from '../tokens';
import type { NotificationApiOptions } from '../notification-api.options';
import type { NotificationAuditEmitter } from '../notification-audit.port';
import type {
  PreviewTemplateBody,
  SetChannelRouteBody,
  SetProviderCredentialBody,
  SetTemplateBody,
} from '../dto/notification-api.dto';
import { booleanParam, enumParam, idParam, objectParam, tenantParam, textParam, variablesParam } from '../shared/params';
import { NotificationTypeCatalog } from '../types/notification-type-catalog';

/** An email subject line — RFC 5322 caps a header line at 998 characters. */
const MAX_SUBJECT = 998;
/** A template body — generous for an HTML email, bounded so a mistake can't fill the table. */
const MAX_BODY = 100_000;
/** A provider credential's JSON — a few keys, never megabytes. */
const MAX_CREDENTIAL_BYTES = 16_384;

/**
 * The actor-scoped rules `@RequiresAction('notification.manage_config')` can't express, plus validation and audit:
 *
 *  - A non-platform admin may only touch rows for **their own tenant** — a `null` tenantId (deployment default) or a
 *    different tenant is rejected.
 *  - Reads (`list*`) show a non-platform actor the deployment defaults plus their own tenant's rows — never another
 *    tenant's routing, white-labeled templates or which tenants hold a provider account.
 *  - Every body is validated — a caller's mistake is a 400 naming what to fix, never a 500.
 *  - Deleting a row that isn't there is a 404.
 *  - Each mutation emits a `NotificationAuditEvent` with the row's own tenant and its `before` / `after` — a credential's
 *    value never.
 */
@Injectable()
export class NotificationConfigAdminApiService {
  constructor(
    @Inject(NOTIFICATION_CONFIG_ADMIN_PORT) private readonly port: NotificationConfigAdminPort,
    @Inject(NOTIFICATION_API_OPTIONS) private readonly options: NotificationApiOptions,
    @Inject(NOTIFICATION_AUDIT_EMITTER) private readonly audit: NotificationAuditEmitter,
    @Optional() private readonly types: NotificationTypeCatalog = new NotificationTypeCatalog(),
    @Optional() @Inject(NOTIFIER) private readonly notifier?: Notifier,
  ) {}

  // ---- routes ----

  async setChannelRoute(actor: Actor, body: SetChannelRouteBody): Promise<void> {
    const input = {
      notificationType: idParam('notificationType', body?.notificationType),
      tenantId: tenantParam('tenantId', body?.tenantId),
      channels: channelsParam(body?.channels),
    };
    this.types.assertKnown(input.notificationType);
    await this.assertTenantWritable(actor, input.tenantId);
    const before = await this.port.getChannelRoute(input.notificationType, input.tenantId);
    await this.port.setChannelRoute(input);
    await this.emit(actor, 'notification.route_set', 'channel_route', input.tenantId, routeId(input.notificationType, input.tenantId), {
      before,
      after: input,
    });
  }

  async deleteChannelRoute(actor: Actor, notificationType: string, tenantId: string | undefined): Promise<void> {
    const key = { notificationType: idParam('notificationType', notificationType), tenantId: idParam('tenantId', tenantId, true) ?? null };
    await this.assertTenantWritable(actor, key.tenantId);
    const before = await this.port.getChannelRoute(key.notificationType, key.tenantId);
    if (!before) throw new NotFoundException('no such route');
    await this.port.deleteChannelRoute(key);
    await this.emit(actor, 'notification.route_deleted', 'channel_route', key.tenantId, routeId(key.notificationType, key.tenantId), {
      before,
    });
  }

  async listChannelRoutes(actor: Actor) {
    return this.port.listChannelRoutes(await this.scopeOf(actor));
  }

  // ---- templates ----

  async setTemplate(actor: Actor, body: SetTemplateBody): Promise<void> {
    const channel = enumParam('channel', body?.channel, NOTIFICATION_CHANNELS);
    if (!channel) throw new BadRequestException('"channel" is required');
    const subject = textParam('subject', body?.subject, MAX_SUBJECT) ?? null;
    const isHtml = booleanParam('isHtml', body?.isHtml) ?? false;
    // An email's subject line; an in-app item's title. HTML is email's alone.
    if (channel !== 'email' && channel !== 'in_app' && subject !== null) {
      throw new BadRequestException('"subject" is for email (its subject line) and in_app (its title) templates only');
    }
    if (channel !== 'email' && isHtml) throw new BadRequestException('"isHtml" is for email templates only');
    const templateBody = textParam('body', body?.body, MAX_BODY);
    if (!templateBody) throw new BadRequestException('"body" is required');
    const input = {
      channel,
      notificationType: idParam('notificationType', body?.notificationType),
      tenantId: tenantParam('tenantId', body?.tenantId),
      subject,
      body: templateBody,
      isHtml,
    };
    this.types.assertKnown(input.notificationType);
    this.types.assertVariables(input.notificationType, input.subject, input.body);
    await this.assertTenantWritable(actor, input.tenantId);
    const before = await this.port.getTemplate(input.channel, input.notificationType, input.tenantId);
    await this.port.setTemplate(input);
    await this.emit(actor, 'notification.template_set', 'template', input.tenantId, templateId(input.channel, input.notificationType, input.tenantId), {
      before,
      after: input,
    });
  }

  async deleteTemplate(actor: Actor, channel: string, notificationType: string, tenantId: string | undefined): Promise<void> {
    const key = {
      channel: requiredChannel(channel),
      notificationType: idParam('notificationType', notificationType),
      tenantId: idParam('tenantId', tenantId, true) ?? null,
    };
    await this.assertTenantWritable(actor, key.tenantId);
    const before = await this.port.getTemplate(key.channel, key.notificationType, key.tenantId);
    if (!before) throw new NotFoundException('no such template');
    await this.port.deleteTemplate(key);
    await this.emit(actor, 'notification.template_deleted', 'template', key.tenantId, templateId(key.channel, key.notificationType, key.tenantId), {
      before,
    });
  }

  async listTemplates(actor: Actor) {
    return this.port.listTemplates(await this.scopeOf(actor));
  }

  /**
   * Renders a candidate template — stateless, no port/persistence involved. With a declared `notificationType`, its
   * variables are checked and its sample values fill whatever `variables` leaves out.
   */
  previewTemplate(body: PreviewTemplateBody) {
    const templateBody = textParam('body', body?.body, MAX_BODY);
    if (templateBody === undefined) throw new BadRequestException('"body" is required');
    const subject = textParam('subject', body?.subject, MAX_SUBJECT);
    const notificationType = idParam('notificationType', body?.notificationType, true);
    if (notificationType) this.types.assertVariables(notificationType, subject, templateBody);
    return renderTemplate(
      { subject, body: templateBody, isHtml: booleanParam('isHtml', body?.isHtml) },
      this.types.withSamples(notificationType, variablesParam('variables', body?.variables)),
    );
  }

  // ---- credentials ----

  async setProviderCredential(actor: Actor, body: SetProviderCredentialBody): Promise<void> {
    const config = objectParam('config', body?.config);
    if (JSON.stringify(config).length > MAX_CREDENTIAL_BYTES) {
      throw new BadRequestException(`"config" must be at most ${MAX_CREDENTIAL_BYTES} bytes of JSON`);
    }
    const input = {
      channel: requiredChannel(body?.channel),
      // null = the platform's own account — platform admins only (assertTenantWritable)
      tenantId: tenantParam('tenantId', body?.tenantId),
      config,
    };
    await this.assertTenantWritable(actor, input.tenantId);
    const existed = await this.port.hasProviderCredential(input.channel, input.tenantId);
    await this.port.setProviderCredential(input);
    // never audit the credential value — only that one was set, and whether it replaced one
    await this.emit(actor, 'notification.credential_set', 'provider_credential', input.tenantId, credentialId(input.channel, input.tenantId), {
      before: existed ? { channel: input.channel, tenantId: input.tenantId, present: true } : null,
      after: { channel: input.channel, tenantId: input.tenantId, present: true },
    });
  }

  async deleteProviderCredential(actor: Actor, channel: string, tenantId: string | undefined): Promise<void> {
    const key = { channel: requiredChannel(channel), tenantId: idParam('tenantId', tenantId, true) ?? null };
    await this.assertTenantWritable(actor, key.tenantId);
    if (!(await this.port.hasProviderCredential(key.channel, key.tenantId))) throw new NotFoundException('no such credential');
    await this.port.deleteProviderCredential(key);
    await this.emit(actor, 'notification.credential_deleted', 'provider_credential', key.tenantId, credentialId(key.channel, key.tenantId), {
      before: { channel: key.channel, tenantId: key.tenantId, present: true },
    });
  }

  /**
   * Does the credential a send on `channel` for this tenant (omitted: the platform's) would use work? Asks the
   * channel's sender to check it with the provider — `supported: false` for one that can't (the stubs). The same
   * tenant rules as editing it.
   */
  async verifyProviderCredential(actor: Actor, channel: string, tenantId: string | undefined): Promise<CredentialCheck> {
    const key = { channel: requiredChannel(channel), tenantId: idParam('tenantId', tenantId, true) ?? null };
    await this.assertTenantWritable(actor, key.tenantId);
    if (!this.notifier) return { supported: false, detail: 'Notifier is not visible to notification.api' };
    return this.notifier.verifyCredential(key.channel, key.tenantId);
  }

  async listProviderCredentials(actor: Actor) {
    return this.port.listProviderCredentials(await this.scopeOf(actor));
  }

  // ---- internals ----

  /** A platform admin sees every row; anyone else the defaults plus their own tenant (a tenantless one: defaults only). */
  private async scopeOf(actor: Actor): Promise<ConfigScope | undefined> {
    if (await this.options.isPlatformAdmin(actor)) return undefined;
    return { tenantId: actor.tenantId ?? '' };
  }

  private async assertTenantWritable(actor: Actor, tenantId: string | null): Promise<void> {
    if (await this.options.isPlatformAdmin(actor)) return;
    if (tenantId === null) {
      throw new ForbiddenException('only a platform admin may edit the deployment-default configuration');
    }
    if (tenantId !== actor.tenantId) {
      throw new ForbiddenException("cannot edit another tenant's notification configuration");
    }
  }

  /** The event belongs to the row's tenant — a platform admin editing tenant A's template is tenant A's history. */
  private emit(
    actor: Actor,
    action: string,
    entityType: string,
    tenantId: string | null,
    entityId: string,
    change: { before?: unknown; after?: unknown },
  ): Promise<void> | void {
    return this.audit.record({ action, actorId: actor.id, tenantId, entityType, entityId, before: change.before ?? undefined, after: change.after });
  }
}

/** A non-empty list of distinct known channels. */
function channelsParam(value: unknown): NotificationChannel[] {
  if (!Array.isArray(value) || value.length === 0) throw new BadRequestException('"channels" must be a non-empty array');
  return [...new Set(value.map((v, i) => requiredChannel(v, `channels[${i}]`)))];
}

function requiredChannel(value: unknown, name = 'channel'): NotificationChannel {
  const channel = enumParam(name, value, NOTIFICATION_CHANNELS);
  if (!channel) throw new BadRequestException(`"${name}" is required`);
  return channel;
}

function routeId(notificationType: string, tenantId: string | null): string {
  return `${notificationType}:${tenantId ?? '*'}`;
}

function credentialId(channel: string, tenantId: string | null): string {
  return `${channel}:${tenantId ?? '*'}`;
}

function templateId(channel: string, notificationType: string, tenantId: string | null): string {
  return `${channel}:${notificationType}:${tenantId ?? '*'}`;
}
