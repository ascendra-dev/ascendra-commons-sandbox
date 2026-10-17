import { DynamicModule, Module } from '@nestjs/common';
import { AUDIT_API_OPTIONS } from './tokens';
import { resolveAuditApiOptions, type AuditApiModuleConfig } from './audit-api.options';
import { AuditEventsApiService } from './audit-events-api.service';
import { AuditEventsController } from './audit-events.controller';

/**
 * HTTP read endpoints for a compliance / ops audit screen, over the
 * `AUDIT_EVENT_READER` port. Opt-in, stack-agnostic — depends on the port
 * (brought in via `imports`), never on a stack adapter. Read-only: audit
 * records are write-once, so there is no mutation surface and no audit-emitter.
 *
 * Requires `AuthorizationGuard` wired globally as `APP_GUARD` — the endpoints
 * declare `@RequiresAction('audit.view')`.
 *
 * ```typescript
 * AuditApiModule.forRoot({
 *   imports: [PostgresAuditObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
 *   catalog: [
 *     { entityType: 'invoice', actions: ['invoice.created', 'invoice.issued', 'invoice.void'] },
 *     { entityType: 'channel_route', actions: ['notification.route_set'] },
 *   ],
 * })
 * ```
 */
@Module({})
export class AuditApiModule {
  static forRoot(config: AuditApiModuleConfig): DynamicModule {
    return {
      module: AuditApiModule,
      imports: config.imports ?? [],
      controllers: [AuditEventsController],
      providers: [
        { provide: AUDIT_API_OPTIONS, useValue: resolveAuditApiOptions(config) },
        AuditEventsApiService,
      ],
    };
  }
}
