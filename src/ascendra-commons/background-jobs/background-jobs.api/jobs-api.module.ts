import { DynamicModule, Module } from '@nestjs/common';
import { JOB_AUDIT_EMITTER, JOB_CORRELATION_ID_RESOLVER } from './tokens';
import type { JobsApiModuleConfig } from './jobs-api.options';
import { NoopJobAuditEmitter } from './job-audit.port';
import { JobsApiService } from './jobs-api.service';
import { JobsController } from './jobs.controller';

/**
 * HTTP endpoints for a background-jobs admin screen — the jobs dashboard, run
 * history, and a "run now" / "retry" trigger — over `JOB_OBSERVABILITY_PORT`
 * (reads) and `JobTrigger` (the action). Opt-in, stack-agnostic.
 *
 * Requires `AuthorizationGuard` wired globally as `APP_GUARD` — the endpoints
 * declare `@RequiresAction('job.view')` / `@RequiresAction('job.run')`. Audit of
 * the manual trigger is opt-in via `auditEmitterToken`.
 *
 * ```typescript
 * JobsApiModule.forRoot({
 *   auditEmitterToken: MY_AUDIT_EMITTER,        // optional
 *   correlationIdResolver: getCurrentCorrelationId, // optional — audit-logging's, so a run traces with its request
 *   imports: [
 *     PostgresJobObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
 *     // BackgroundJobsModule.forRoot(...) exports JobTrigger — import it here too if it isn't otherwise visible.
 *   ],
 * })
 * ```
 */
@Module({})
export class JobsApiModule {
  static forRoot(config: JobsApiModuleConfig = {}): DynamicModule {
    return {
      module: JobsApiModule,
      imports: config.imports ?? [],
      controllers: [JobsController],
      providers: [
        config.auditEmitterToken
          ? { provide: JOB_AUDIT_EMITTER, useExisting: config.auditEmitterToken }
          : { provide: JOB_AUDIT_EMITTER, useClass: NoopJobAuditEmitter },
        ...(config.correlationIdResolver
          ? [{ provide: JOB_CORRELATION_ID_RESOLVER, useValue: config.correlationIdResolver }]
          : []),
        JobsApiService,
      ],
    };
  }
}
