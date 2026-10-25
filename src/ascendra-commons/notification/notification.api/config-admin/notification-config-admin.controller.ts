import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthorizationEnforcedGuard, CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { NOTIFICATION_ACTIONS } from '../notification-api.options';
import { NotificationConfigAdminApiService } from './notification-config-admin-api.service';
import type {
  PreviewTemplateBody,
  SetChannelRouteBody,
  SetProviderCredentialBody,
  SetTemplateBody,
} from '../dto/notification-api.dto';

/**
 * CRUD on routing / template / provider-credential rows. `list*` reads are gated
 * on `notification.view`; writes on `notification.manage_config` and
 * tenant-ceiling-scoped to the request actor in the service. Requires
 * `AuthorizationGuard` wired globally as `APP_GUARD` — and fails closed without it (`AuthorizationEnforcedGuard`).
 */
@Controller('notifications/config')
@UseGuards(AuthorizationEnforcedGuard)
export class NotificationConfigAdminController {
  constructor(
    @Inject(NotificationConfigAdminApiService) private readonly service: NotificationConfigAdminApiService,
  ) {}

  // routes

  @Get('routes')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  listRoutes(@CurrentActor() actor: Actor) {
    return this.service.listChannelRoutes(actor);
  }

  @Put('routes')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  setRoute(@CurrentActor() actor: Actor, @Body() body: SetChannelRouteBody) {
    return this.service.setChannelRoute(actor, body);
  }

  /** `?tenantId=` names a tenant's row; omitted, the deployment default. A row that isn't there is a 404. */
  @Delete('routes/:notificationType')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  deleteRoute(
    @CurrentActor() actor: Actor,
    @Param('notificationType') notificationType: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.deleteChannelRoute(actor, notificationType, tenantId);
  }

  // templates

  @Get('templates')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  listTemplates(@CurrentActor() actor: Actor) {
    return this.service.listTemplates(actor);
  }

  @Put('templates')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  setTemplate(@CurrentActor() actor: Actor, @Body() body: SetTemplateBody) {
    return this.service.setTemplate(actor, body);
  }

  /** `?tenantId=` names a tenant's row; omitted, the deployment default. */
  @Delete('templates/:channel/:notificationType')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  deleteTemplate(
    @CurrentActor() actor: Actor,
    @Param('channel') channel: string,
    @Param('notificationType') notificationType: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.deleteTemplate(actor, channel, notificationType, tenantId);
  }

  @Post('templates/preview')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  previewTemplate(@Body() body: PreviewTemplateBody) {
    return this.service.previewTemplate(body);
  }

  // credentials (values never returned)

  @Get('credentials')
  @RequiresAction(NOTIFICATION_ACTIONS.VIEW)
  listCredentials(@CurrentActor() actor: Actor) {
    return this.service.listProviderCredentials(actor);
  }

  @Put('credentials')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  setCredential(@CurrentActor() actor: Actor, @Body() body: SetProviderCredentialBody) {
    return this.service.setProviderCredential(actor, body);
  }

  /** Asks the provider whether the credential works — `?tenantId=` as for a delete. */
  @Post('credentials/:channel/verify')
  @HttpCode(200)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  verifyCredential(@CurrentActor() actor: Actor, @Param('channel') channel: string, @Query('tenantId') tenantId?: string) {
    return this.service.verifyProviderCredential(actor, channel, tenantId);
  }

  /** `?tenantId=` names a tenant's account; omitted, the platform's own (platform admins only). */
  @Delete('credentials/:channel')
  @HttpCode(204)
  @RequiresAction(NOTIFICATION_ACTIONS.MANAGE_CONFIG)
  deleteCredential(@CurrentActor() actor: Actor, @Param('channel') channel: string, @Query('tenantId') tenantId?: string) {
    return this.service.deleteProviderCredential(actor, channel, tenantId);
  }
}
