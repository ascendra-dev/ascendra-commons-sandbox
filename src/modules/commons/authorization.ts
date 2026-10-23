import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { ScheduledJob } from '../../ascendra-commons/background-jobs/background-jobs.core';
import { sql } from 'drizzle-orm';
import { AuthorizationModule } from '../../ascendra-commons/authorization/authorization.core';
import { getCurrentCorrelationId } from '../../ascendra-commons/audit-logging/audit-logging.core';
import { PERMISSION_TABLE_AUTHORIZER } from '../../ascendra-commons/authorization/authorization.core.permission-table';
import {
  POSTGRES_ACCESS_DENIAL_RECORDER,
  PostgresAccessDenialObservabilityModule,
  PostgresAccessDenialRecorderModule,
  PostgresAccessDenialRetention,
  PostgresAuthzAdminModule,
  PostgresPermissionTableModule,
  seedRolesFromPersonaMap,
  syncActions,
  type ActionCatalogEntry,
  type SqlExecutor,
} from '../../ascendra-commons/authorization/authorization.core.permission-table.postgres-drizzle';
import {
  AUTHZ_ACTIONS,
  AuthorizationApiModule,
  type AuthzAuditEmitter,
  type AuthzAuditEvent,
} from '../../ascendra-commons/authorization/authorization.api';
import { AUDIT_ACTIONS } from '../../ascendra-commons/audit-logging/audit-logging.api';
import { AUDIT_EVENT_NAME, AuditRecordRaised } from '../../ascendra-commons/audit-logging/audit-logging.core';
import { JOB_ACTIONS } from '../../ascendra-commons/background-jobs/background-jobs.api';
import { DOMAIN_EVENT_EMITTER, type DomainEventEmitter } from '../../ascendra-commons/domain-events/domain-events.core';
import { DOMAIN_EVENTS_ACTIONS } from '../../ascendra-commons/domain-events/domain-events.api';
import { IDEMPOTENCY_ACTIONS } from '../../ascendra-commons/idempotency-key/idempotency-key.api';
import { RATE_LIMIT_ACTIONS } from '../../ascendra-commons/rate-limiting/rate-limiting.api';
import { DEV_ACTORS } from '../../auth/dev-actors';
import { DEMO_ACTIONS, DEMO_ROLES } from '../../demo/demo-access';
import { DemoUserDirectory, DemoUsersModule } from '../../demo/demo-users';
import { DATABASE_CONNECTION, DatabaseModule, type Database } from '../../db/database.module';
import { domainEvents } from './domain-events';

const application = process.env.APPLICATION ?? 'ascendra-commons-sandbox';

/** Every action this app knows — `GET /me` reports which of these the actor holds; the boot sync writes the catalog. */
export const ALL_ACTIONS: string[] = [
  ...Object.values(AUDIT_ACTIONS),
  ...Object.values(RATE_LIMIT_ACTIONS),
  ...Object.values(IDEMPOTENCY_ACTIONS),
  ...Object.values(DOMAIN_EVENTS_ACTIONS),
  ...Object.values(JOB_ACTIONS),
  ...Object.values(AUTHZ_ACTIONS),
  ...Object.values(DEMO_ACTIONS),
];

/**
 * The actions that read or change every tenant's data — a role holding one can only be assigned globally, by a
 * platform admin. Rate-limit rejections, idempotency claims, domain-event deliveries and job runs carry no tenant; the
 * catalog and `authz.platform` are the whole app's. Everything else acts within one tenant.
 */
const PLATFORM_ACTIONS = new Set<string>([
  ...Object.values(RATE_LIMIT_ACTIONS),
  ...Object.values(IDEMPOTENCY_ACTIONS),
  ...Object.values(DOMAIN_EVENTS_ACTIONS),
  ...Object.values(JOB_ACTIONS),
  AUTHZ_ACTIONS.PLATFORM,
  AUTHZ_ACTIONS.MANAGE_CATALOG,
]);

/** The catalog with each action's scope — what the boot sync writes. */
export const ACTION_CATALOG: ActionCatalogEntry[] = ALL_ACTIONS.map((name) => ({
  name,
  scope: PLATFORM_ACTIONS.has(name) ? 'platform' : 'tenant',
}));

/**
 * The roles this app ships, as persona → actions — seeded into authorization's role tables at boot (Model 2: roles in
 * the database, assigned per user and tenant). Each role is named after the persona it came from. `rate-limit.view` is
 * platform-only: a rejection has no tenant (the caller wasn't signed in), so a tenant admin would see every tenant's
 * traffic. `idempotency.view` too — a claim's scope is opaque to the module, so it can't be limited to one tenant.
 * `idempotency.view-response` (a claim's saved body — it can hold personal data) is the platform admin's alone.
 * `domain-events.view` is platform-only too: a delivery row has no tenant, and the wiring it shows is the whole app's.
 * `job.view` is platform-only — a run covers every tenant's due items — and `job.run` the platform admin's alone.
 * Access management: the platform admin holds all of it (`authz.platform` — across tenants); platform support reads
 * every tenant's access but changes none; a tenant admin views, assigns roles and manages delegations in its own
 * tenant; a member may lend its own actions (delegation).
 */
export const PERSONA_ACTIONS: Record<string, string[]> = {
  'platform-admin': [
    AUDIT_ACTIONS.VIEW,
    RATE_LIMIT_ACTIONS.VIEW,
    IDEMPOTENCY_ACTIONS.VIEW,
    IDEMPOTENCY_ACTIONS.VIEW_RESPONSE,
    DOMAIN_EVENTS_ACTIONS.VIEW,
    JOB_ACTIONS.VIEW,
    JOB_ACTIONS.RUN,
    ...Object.values(AUTHZ_ACTIONS),
  ],
  'platform-support': [
    RATE_LIMIT_ACTIONS.VIEW,
    IDEMPOTENCY_ACTIONS.VIEW,
    DOMAIN_EVENTS_ACTIONS.VIEW,
    JOB_ACTIONS.VIEW,
    // Reads every tenant's access (authz.platform) — but assigns nothing: no authz.assign_roles.
    AUTHZ_ACTIONS.VIEW,
    AUTHZ_ACTIONS.PLATFORM,
  ],
  // Holds every product action too — so it can hand out every product role (the role ceiling: only what you hold).
  'tenant-admin': [
    AUDIT_ACTIONS.VIEW,
    AUTHZ_ACTIONS.VIEW,
    AUTHZ_ACTIONS.ASSIGN_ROLES,
    AUTHZ_ACTIONS.MANAGE_DELEGATIONS,
    ...Object.values(DEMO_ACTIONS),
  ],
  member: [AUTHZ_ACTIONS.MANAGE_DELEGATIONS],
};

/** Every role the app ships: the personas' and the stand-in product roles (src/demo/demo-access.ts). */
export const ROLE_ACTIONS: Record<string, string[]> = { ...PERSONA_ACTIONS, ...DEMO_ROLES };

/** What each role is for — what the console shows beside it. Part of the role's definition, so it ships with it. */
export const ROLE_DESCRIPTIONS: Record<string, string> = {
  'platform-admin': 'Runs the platform: every tenant, its operations and who can do what',
  'platform-support': "Reads every tenant's operations and access; changes nothing",
  'tenant-admin': "Runs the tenant: its people's roles, its audit log, every product action",
  member: 'Signed in, nothing more — can lend what it is lent',
  viewer: 'Sees invoices, customers and payouts',
  'billing-clerk': 'Drafts and sends invoices, records payments',
  'support-agent': 'Looks after customers; refunds payments',
  'finance-approver': 'Approves payouts and refunds, voids invoices, exports reports',
  auditor: 'Reads invoices, payouts and customers; exports reports',
};

const authzStore = () => [
  PostgresPermissionTableModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
];

/** Every 403 the guard answers, counted in memory and written every 10s — one instance (it holds the buffer). */
export const denialRecorder = PostgresAccessDenialRecorderModule.forRoot({
  sqlExecutorToken: DATABASE_CONNECTION,
  application,
  correlationIdResolver: getCurrentCorrelationId,
  imports: [DatabaseModule],
});

/** The denied-requests log's reads and its prune (`access-denial-retention`, a background job). */
export const denialLog = PostgresAccessDenialObservabilityModule.forRoot({
  sqlExecutorToken: DATABASE_CONNECTION,
  application,
  imports: [DatabaseModule],
});

/**
 * authorization, Model 2 (the permission table): roles, assignments and delegations in Postgres. It reads
 * `request.actor`, which authentication sets first — here the dev sign-in (src/auth), in a product the real identity
 * provider; only the actor's id and tenant matter here, never its persona. The global guard order lives in src/auth.
 */
export const authorization = AuthorizationModule.forRoot({
  authorizerToken: PERMISSION_TABLE_AUTHORIZER,
  denialRecorderToken: POSTGRES_ACCESS_DENIAL_RECORDER,
  imports: [...authzStore(), denialRecorder],
});

/** An access change, recorded in audit-logging — through domain-events, as every audit record is. */
@Injectable()
class AuditAuthzEmitter implements AuthzAuditEmitter {
  constructor(@Inject(DOMAIN_EVENT_EMITTER) private readonly events: DomainEventEmitter) {}

  record(event: AuthzAuditEvent): Promise<void> {
    // 'authz.role_assigned' → entity user_role, action 'assigned' (the catalog's vocabulary — audit-catalog.ts).
    const verb = event.action.replace(/^authz\./, '').split('_').pop() ?? event.action;
    return this.events.emitCritical(
      AUDIT_EVENT_NAME,
      new AuditRecordRaised({
        entityType: event.entityType,
        entityId: event.entityId,
        tenantId: event.tenantId,
        actor: event.actorId,
        action: verb,
        before: event.before as Record<string, unknown> | undefined,
        after: event.after as Record<string, unknown> | undefined,
        occurredAt: new Date(),
      }),
    );
  }
}

@Module({ imports: [domainEvents], providers: [AuditAuthzEmitter], exports: [AuditAuthzEmitter] })
class AuditAuthzEmitterModule {}

/**
 * The access-management API (`/authz/*`) — people (through the sandbox's users table), roles, assignments,
 * delegations, explain, who-can, the catalog, posture and denied requests.
 */
export const authorizationApi = AuthorizationApiModule.forRoot({
  actionCatalog: ALL_ACTIONS,
  auditEmitterToken: AuditAuthzEmitter,
  userDirectoryToken: DemoUserDirectory,
  imports: [
    PostgresAuthzAdminModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, imports: [DatabaseModule] }),
    ...authzStore(),
    denialLog,
    DemoUsersModule,
    AuditAuthzEmitterModule,
  ],
});

/**
 * The deploy step a product runs as a migration or release task: the action catalog and the shipped roles, synced at
 * boot (idempotent — it adds, never removes). Plus the sandbox's own part: every dev user holds the role named after
 * its persona, in its tenant — so signing in works before `npm run seed`.
 */
@Injectable()
class AuthzBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger('AuthzBootstrap');

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async onApplicationBootstrap() {
    // authorization's SqlExecutor is generic over its row type; Drizzle's database answers untyped rows.
    const executor = this.db as unknown as SqlExecutor;
    await syncActions(executor, ACTION_CATALOG);
    await seedRolesFromPersonaMap(executor, ROLE_ACTIONS);
    // The seed helper writes a placeholder description on insert; the app's own wording ships with the roles.
    for (const [role, description] of Object.entries(ROLE_DESCRIPTIONS)) {
      await this.db.execute(sql`update commons_authz_role set description = ${description} where id = ${role}`);
    }
    for (const actor of DEV_ACTORS) {
      // The directory knows the dev users too (a product's users table would).
      await this.db.execute(sql`
        insert into demo_user (id, name, email, tenant_id)
        values (${actor.id}, ${actor.name}, ${actor.id}, ${actor.tenantId})
        on conflict (id) do nothing
      `);
      await this.db.execute(sql`
        insert into commons_authz_user_role (user_id, tenant_id, role_id, granted_by)
        values (${actor.id}, ${actor.tenantId}, ${actor.persona}, 'system')
        on conflict on constraint commons_authz_user_role_uq do nothing
      `);
    }
    this.logger.log(`Synced ${ALL_ACTIONS.length} actions and ${Object.keys(ROLE_ACTIONS).length} roles`);
  }
}

@Module({ imports: [DatabaseModule], providers: [AuthzBootstrap] })
export class AuthzBootstrapModule {}

const DENIAL_RETENTION_DAYS = 90;

/** Denied-request windows older than 90 days, pruned — a background job (src/modules/commons/background-jobs.ts). */
@Injectable()
export class AccessDenialRetentionJob implements ScheduledJob<Date> {
  readonly name = 'access-denial-retention';
  private readonly logger = new Logger('AccessDenialRetention');

  constructor(@Inject(PostgresAccessDenialRetention) private readonly retention: PostgresAccessDenialRetention) {}

  async findDueItems(): Promise<Date[]> {
    return [new Date(Date.now() - DENIAL_RETENTION_DAYS * 24 * 60 * 60 * 1000)];
  }

  async processItem(cutoff: Date): Promise<void> {
    const pruned = await this.retention.pruneDenials(cutoff);
    if (pruned > 0) this.logger.log(`Pruned ${pruned} denied-request window(s) older than ${DENIAL_RETENTION_DAYS} days`);
  }

  describeItem(cutoff: Date): string {
    return `denied-request windows before ${cutoff.toISOString()}`;
  }
}

@Module({ imports: [denialLog], providers: [AccessDenialRetentionJob], exports: [AccessDenialRetentionJob] })
export class AccessDenialRetentionModule {}
