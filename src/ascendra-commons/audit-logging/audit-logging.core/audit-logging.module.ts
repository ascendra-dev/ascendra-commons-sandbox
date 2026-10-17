import { DynamicModule, Module } from '@nestjs/common';
import { AuditListener } from './audit-listener';
import { AUDIT_EVENT_REPOSITORY } from './tokens';

export interface AuditLoggingModuleConfig {
  /** The injection token the consumer's own AuditEventRepository implementation is already provided under. */
  auditEventRepositoryToken: string | symbol | (new (...args: never[]) => unknown);

  /**
   * Whatever module(s) export the provider behind auditEventRepositoryToken.
   * useExisting only resolves a token NestJS can already see in *this*
   * module's own providers or imports — not anywhere in the wider
   * application graph — the same reason BackgroundJobsModule.forRoot() needs
   * this field. Omit only if that provider's own module is global: true.
   */
  imports?: DynamicModule['imports'];
}

/**
 * A dynamic module — requires config because there's no default for which
 * provider is the consumer's audit repository. Ships AuditListener itself
 * (see audit-listener.ts) — possible because AUDIT_EVENT_NAME is one fixed,
 * library-defined event name, never project-specific, unlike the older design
 * this replaced (see audit-record-raised.ts's own doc comment). The consumer
 * writes no listener at all: raise an AuditRecordRaised under AUDIT_EVENT_NAME
 * wherever a state change should be audited, and this module's own listener
 * picks it up.
 */
@Module({})
export class AuditLoggingModule {
  static forRoot(config: AuditLoggingModuleConfig): DynamicModule {
    return {
      module: AuditLoggingModule,
      imports: config.imports ?? [],
      providers: [{ provide: AUDIT_EVENT_REPOSITORY, useExisting: config.auditEventRepositoryToken }, AuditListener],
      exports: [AUDIT_EVENT_REPOSITORY],
    };
  }
}
