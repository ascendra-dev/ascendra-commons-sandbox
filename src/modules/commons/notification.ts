import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import type { ScheduledJob } from '../../ascendra-commons/background-jobs/background-jobs.core';
import { AUDIT_EVENT_NAME, AuditRecordRaised } from '../../ascendra-commons/audit-logging/audit-logging.core';
import { DOMAIN_EVENT_EMITTER, type DomainEventEmitter } from '../../ascendra-commons/domain-events/domain-events.core';
import { NotificationModule } from '../../ascendra-commons/notification/notification.core';
import {
  NotificationApiModule,
  type NotificationAuditEmitter,
  type NotificationAuditEvent,
} from '../../ascendra-commons/notification/notification.api';
import {
  POSTGRES_NOTIFICATION_CONFIG,
  POSTGRES_NOTIFICATION_DEDUPLICATOR,
  POSTGRES_NOTIFICATION_DELIVERY_RECORDER,
  POSTGRES_NOTIFICATION_INBOX,
  POSTGRES_NOTIFICATION_PREFERENCES,
  POSTGRES_NOTIFICATION_SUPPRESSION_LIST,
  PostgresNotificationAdminModule,
  PostgresNotificationConfigModule,
  PostgresNotificationDedupeModule,
  PostgresNotificationDeliveryRecorderModule,
  PostgresNotificationInboxModule,
  PostgresNotificationPreferencesModule,
  PostgresNotificationRetentionModule,
  PostgresNotificationRetentionService,
  PostgresNotificationSuppressionModule,
} from '../../ascendra-commons/notification/notification.core.database.postgres-drizzle';
import { DATABASE_CONNECTION, DatabaseModule } from '../../db/database.module';
import {
  DemoContactResolver,
  DemoNotificationDirectoryModule,
  DemoTenantDirectory,
  FakeEmailSender,
  FakeSmsSender,
  FakeWhatsappSender,
  NOTIFICATION_TYPES,
} from '../../demo/demo-notifications';
import { domainEvents } from './domain-events';

const application = process.env.APPLICATION ?? 'ascendra-commons-sandbox';

/**
 * The secret raw recipients' addresses are hashed with (search a guest's deliveries, suppress a bounced address). A
 * product reads it from its secret store; the sandbox has a fixed dev default so seeded hashes stay searchable.
 */
const RECIPIENT_HASH_KEY = process.env.NOTIFICATION_HASH_KEY ?? 'sandbox-dev-notification-hash-key';

const db = { sqlExecutorToken: DATABASE_CONNECTION, application, imports: [DatabaseModule] };

/** The modules behind the notification store — each imported where its token is needed. */
const store = {
  // Routing, templates and credentials in Postgres; a tenant without its own provider account uses the platform's.
  config: PostgresNotificationConfigModule.forRoot({ ...db, tenantCredentialFallback: true }),
  // The delivery log, buffered — and keeping the rendered message (for the content view and retry), cleared at 30 days.
  recorder: PostgresNotificationDeliveryRecorderModule.forRoot({ ...db, storeContent: true }),
  suppression: PostgresNotificationSuppressionModule.forRoot(db),
  dedupe: PostgresNotificationDedupeModule.forRoot(db),
  preferences: PostgresNotificationPreferencesModule.forRoot(db),
  inbox: PostgresNotificationInboxModule.forRoot(db),
};

/**
 * notification, Model 2, with every option on: the product's declared types, fake providers standing in for SES /
 * Twilio / Meta (src/demo/demo-notifications.ts), keyed hashes of guests' addresses, the suppression list, dedupe keys,
 * users' preferences and the in-app inbox. What a feature injects is `NOTIFIER`.
 */
export const notification = NotificationModule.forRoot({
  configToken: POSTGRES_NOTIFICATION_CONFIG,
  deliveryRecorderToken: POSTGRES_NOTIFICATION_DELIVERY_RECORDER,
  userContactResolverToken: DemoContactResolver,
  senders: { email: FakeEmailSender, sms: FakeSmsSender, whatsapp: FakeWhatsappSender },
  types: NOTIFICATION_TYPES,
  recipientHashKey: RECIPIENT_HASH_KEY,
  suppressionListToken: POSTGRES_NOTIFICATION_SUPPRESSION_LIST,
  deduplicatorToken: POSTGRES_NOTIFICATION_DEDUPLICATOR,
  preferencesToken: POSTGRES_NOTIFICATION_PREFERENCES,
  inboxToken: POSTGRES_NOTIFICATION_INBOX,
  imports: [store.config, store.recorder, store.suppression, store.dedupe, store.preferences, store.inbox, DemoNotificationDirectoryModule],
});

/** A config edit, a content read, a retry, a removed suppression — recorded in audit-logging, through domain-events. */
@Injectable()
class AuditNotificationEmitter implements NotificationAuditEmitter {
  constructor(@Inject(DOMAIN_EVENT_EMITTER) private readonly events: DomainEventEmitter) {}

  record(event: NotificationAuditEvent): Promise<void> {
    // 'notification.template_set' → entity template, action 'set' (the catalog's vocabulary — audit-catalog.ts).
    const verb = event.action.replace(/^notification\./, '').split('_').pop() ?? event.action;
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

@Module({ imports: [domainEvents], providers: [AuditNotificationEmitter], exports: [AuditNotificationEmitter] })
class AuditNotificationEmitterModule {}

/**
 * The notification console's API (`/notifications/*`): the delivery log, stats and volume, routing / templates /
 * credentials, types, suppressions, test send and retry — and the signed-in user's own preferences and inbox.
 */
export const notificationApi = NotificationApiModule.forRoot({
  auditEmitterToken: AuditNotificationEmitter,
  tenantDirectoryToken: DemoTenantDirectory,
  imports: [
    PostgresNotificationAdminModule.forRoot({ ...db, tenantCredentialFallback: true }),
    notification,
    store.preferences,
    store.inbox,
    DemoNotificationDirectoryModule,
    AuditNotificationEmitterModule,
  ],
});

/** How long each kind of row is kept. */
const RETENTION = { contentDays: 30, deliveryDays: 90, inboxDays: 90 };

/**
 * notification's retention, as a background job (src/modules/commons/background-jobs.ts): stored message content
 * cleared at 30 days, delivery rows deleted at 90, inbox items at 90, expired dedupe keys. One item, run daily.
 */
@Injectable()
export class NotificationRetentionJob implements ScheduledJob<Date> {
  readonly name = 'notification-retention';
  private readonly logger = new Logger('NotificationRetention');

  constructor(@Inject(PostgresNotificationRetentionService) private readonly retention: PostgresNotificationRetentionService) {}

  async findDueItems(): Promise<Date[]> {
    return [new Date()];
  }

  async processItem(now: Date): Promise<void> {
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const cleared = await this.retention.clearContent(daysAgo(RETENTION.contentDays));
    const deliveries = await this.retention.pruneDeliveries(daysAgo(RETENTION.deliveryDays));
    const inbox = await this.retention.pruneInbox(daysAgo(RETENTION.inboxDays));
    const keys = await this.retention.pruneDedupeKeys(now);
    if (cleared + deliveries + inbox + keys > 0) {
      this.logger.log(`Cleared ${cleared} stored message(s); pruned ${deliveries} deliveries, ${inbox} inbox item(s), ${keys} dedupe key(s)`);
    }
  }

  describeItem(now: Date): string {
    return `notification rows older than their retention, as of ${now.toISOString()}`;
  }
}

@Module({
  imports: [PostgresNotificationRetentionModule.forRoot(db)],
  providers: [NotificationRetentionJob],
  exports: [NotificationRetentionJob],
})
export class NotificationRetentionModule {}
