import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  NOTIFICATION_CONFIG,
  USER_CONTACT_RESOLVER,
  renderTemplate,
  type NotificationChannel,
  type NotificationChannelResult,
  type NotificationConfig,
  type NotificationConfigData,
  type NotificationRequest,
  type NotificationSender,
  type NotificationTypeDefinition,
  type ProviderConfig,
  type UserContactResolver,
} from '../ascendra-commons/notification/notification.core';
import type { NotificationTenantDirectory } from '../ascendra-commons/notification/notification.api';
import { DATABASE_CONNECTION, DatabaseModule, type Database } from '../db/database.module';

/**
 * The sandbox has no product, so it has no notifications of its own — yet a delivery log, routing, templates and
 * preferences mean nothing without them. These stand in for what a product declares: an invoicing product's types,
 * the default routing and templates it ships, and senders that behave like a provider without one.
 */

/** What the product sends — `NotificationModule.forRoot({ types })`. Names follow the action catalog's style. */
export const NOTIFICATION_TYPES: NotificationTypeDefinition[] = [
  {
    name: 'invoice.sent',
    description: 'The payer is told their invoice is ready, with a link to pay',
    audience: 'payer',
    variables: [
      { name: 'customerName', sample: 'Acme Ltd' },
      { name: 'invoiceNumber', sample: 'INV-0042' },
      { name: 'amount', sample: '4,820.00' },
      { name: 'currency', sample: 'USD' },
      { name: 'dueDate', sample: '2026-11-15' },
    ],
  },
  {
    name: 'invoice.reminder',
    description: 'A reminder before — and after — an invoice falls due',
    audience: 'payer',
    variables: [
      { name: 'customerName', sample: 'Acme Ltd' },
      { name: 'invoiceNumber', sample: 'INV-0042' },
      { name: 'amount', sample: '4,820.00' },
      { name: 'currency', sample: 'USD' },
      { name: 'daysOverdue', sample: 3 },
    ],
  },
  {
    name: 'payment.confirmed',
    description: 'The payer is told their payment arrived',
    audience: 'payer',
    variables: [
      { name: 'customerName', sample: 'Acme Ltd' },
      { name: 'invoiceNumber', sample: 'INV-0042' },
      { name: 'amount', sample: '4,820.00' },
      { name: 'currency', sample: 'USD' },
    ],
  },
  {
    name: 'payout.approved',
    description: "A tenant's finance staff are told a payout was approved",
    audience: 'tenant staff',
    variables: [
      { name: 'amount', sample: '12,000.00' },
      { name: 'currency', sample: 'USD' },
      { name: 'approvedBy', sample: 'Hana Ito' },
    ],
  },
  {
    name: 'role.assigned',
    description: 'Someone is told they were given a role',
    audience: 'tenant staff',
    variables: [
      { name: 'roleName', sample: 'billing-clerk' },
      { name: 'grantedBy', sample: 'Acme Admin' },
    ],
  },
  {
    name: 'report.ready',
    description: 'An exported report is ready to download',
    audience: 'tenant staff',
    variables: [{ name: 'reportName', sample: 'September statements' }],
  },
  {
    name: 'password.reset',
    description: 'A password-reset link — always sent; nobody can turn it off',
    audience: 'everyone',
    required: true,
    variables: [{ name: 'resetLink', sample: 'https://app.example.test/reset/abc123' }],
  },
  {
    name: 'job.failed',
    description: 'Platform staff are told a background job failed — no tenant',
    audience: 'platform staff',
    variables: [
      { name: 'jobName', sample: 'payout-sweep' },
      { name: 'error', sample: 'connection reset by peer' },
    ],
  },
];

/**
 * The routing and templates the product ships — the deployment defaults (`tenant_id` NULL), written by the seed with
 * `seedNotificationConfigFromData`, not at boot: an admin may edit them, and a boot-time upsert would undo that.
 * `report.ready` is in-app only; `payout.approved` has no SMS template on purpose (a coverage gap to find).
 */
export const NOTIFICATION_DEFAULTS: NotificationConfigData = {
  channels: {
    'invoice.sent': ['email'],
    'invoice.reminder': ['email', 'sms'],
    'payment.confirmed': ['email', 'whatsapp'],
    'payout.approved': ['email', 'sms', 'in_app'],
    'role.assigned': ['email', 'in_app'],
    'report.ready': ['in_app'],
    'password.reset': ['email'],
    'job.failed': ['email', 'in_app'],
  },
  templates: {
    email: {
      'invoice.sent': {
        subject: 'Invoice {{invoiceNumber}} from your supplier',
        body: 'Hi {{customerName}},\n\nInvoice {{invoiceNumber}} for {{amount}} {{currency}} is ready. Please pay by {{dueDate}}.',
      },
      'invoice.reminder': {
        subject: 'Reminder: invoice {{invoiceNumber}}',
        body: 'Hi {{customerName}},\n\nInvoice {{invoiceNumber}} for {{amount}} {{currency}} is {{daysOverdue}} day(s) overdue.',
      },
      'payment.confirmed': {
        subject: 'Payment received for {{invoiceNumber}}',
        body: 'Hi {{customerName}},\n\nWe received {{amount}} {{currency}} for invoice {{invoiceNumber}}. Thank you.',
      },
      'payout.approved': { subject: 'Payout approved', body: 'A payout of {{amount}} {{currency}} was approved by {{approvedBy}}.' },
      'role.assigned': { subject: 'You have a new role', body: '{{grantedBy}} gave you the {{roleName}} role.' },
      'password.reset': { subject: 'Reset your password', body: 'Use this link to reset your password: {{resetLink}}' },
      'job.failed': { subject: 'Job {{jobName}} failed', body: 'The {{jobName}} job failed: {{error}}' },
    },
    sms: {
      'invoice.reminder': { body: 'Invoice {{invoiceNumber}}: {{amount}} {{currency}} is {{daysOverdue}} day(s) overdue.' },
    },
    in_app: {
      'payout.approved': { subject: 'Payout approved', body: '{{amount}} {{currency}}, approved by {{approvedBy}}.' },
      'role.assigned': { subject: 'New role: {{roleName}}', body: '{{grantedBy}} gave you the {{roleName}} role.' },
      'report.ready': { subject: 'Your report is ready', body: '{{reportName}} is ready to download.' },
      'job.failed': { subject: 'Job failed: {{jobName}}', body: '{{error}}' },
    },
  },
  // The platform's own account on each provider — tenants fall back to it (tenantCredentialFallback); the seed adds a
  // few tenants' own accounts on top.
  platformProviderConfigs: {
    email: { provider: 'fake-ses', apiKey: 'platform-email-key', from: 'notifications@ascendra.test' },
    sms: { provider: 'fake-twilio', apiKey: 'platform-sms-key', from: '+15550000000' },
    whatsapp: { provider: 'fake-meta', apiKey: 'platform-wa-key' },
  },
};

/**
 * Behaves like a provider without being one. An address (or phone) containing `invalid` is rejected outright — a
 * `failed` delivery; one containing `bounce` is accepted, and the seed later reports it bounced through the delivery
 * recorder (the webhook path). A credential whose `apiKey` is `revoked` fails every send — and `verify()` — as an
 * expired key would. Every accepted message gets a provider id, so a status update can find its row.
 */
abstract class FakeProviderSender implements NotificationSender {
  protected abstract readonly channel: NotificationChannel;
  private readonly logger = new Logger('FakeProvider');

  constructor(
    @Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig,
    @Inject(USER_CONTACT_RESOLVER) private readonly users: UserContactResolver,
  ) {}

  async send(request: NotificationRequest): Promise<NotificationChannelResult> {
    const to = await this.address(request);
    if (!to) return { status: 'failed', reason: 'no_address_available' };
    const credential = await this.config.providerConfigFor(this.channel, request.tenantId ?? null);
    if (!credential) return { status: 'failed', reason: 'no_provider_config' };
    if (credential.apiKey === 'revoked') return { status: 'failed', reason: 'provider_auth_failed: 401 invalid api key' };

    // WhatsApp's templates live on Meta's side — the provider is handed the variables, nothing rendered here.
    const template = this.channel === 'whatsapp' ? null : await this.config.templateFor(this.channel, request.notificationType, request.tenantId ?? null);
    if (this.channel !== 'whatsapp' && !template) return { status: 'failed', reason: 'template_not_found' };
    if (to.includes('invalid')) return { status: 'failed', reason: 'provider_rejected: 550 recipient address rejected' };

    const rendered = template ? renderTemplate(template, request.variables) : undefined;
    const providerMessageId = `${credential.provider ?? 'fake'}-${randomUUID().slice(0, 12)}`;
    this.logger.debug(`${this.channel} · ${request.notificationType} accepted as ${providerMessageId}`);
    return { status: 'sent', providerMessageId, rendered };
  }

  async verify(credential: ProviderConfig): Promise<{ ok: boolean; detail?: string }> {
    if (credential.apiKey === 'revoked') return { ok: false, detail: '401 — the API key was revoked' };
    if (typeof credential.apiKey !== 'string' || credential.apiKey.length === 0) return { ok: false, detail: 'no apiKey in the credential' };
    return { ok: true, detail: `${String(credential.provider ?? 'provider')}: key accepted` };
  }

  private async address(request: NotificationRequest): Promise<string | null> {
    const wantsPhone = this.channel !== 'email';
    if (request.recipient.type === 'raw') return (wantsPhone ? request.recipient.phone : request.recipient.email) ?? null;
    const user = await this.users.findById(request.recipient.id);
    return (wantsPhone ? user?.phone : user?.email) ?? null;
  }
}

@Injectable()
export class FakeEmailSender extends FakeProviderSender {
  protected readonly channel = 'email' as const;
}

@Injectable()
export class FakeSmsSender extends FakeProviderSender {
  protected readonly channel = 'sms' as const;
}

@Injectable()
export class FakeWhatsappSender extends FakeProviderSender {
  protected readonly channel = 'whatsapp' as const;
}

/**
 * notification's `UserContactResolver` over `demo_user` — an email, a phone, and the tenant (so a tenant admin's test
 * send can reach a colleague, and nobody else).
 */
@Injectable()
export class DemoContactResolver implements UserContactResolver {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async findById(id: string): Promise<{ email?: string; phone?: string; tenantId: string | null } | null> {
    const { rows } = await this.db.execute(sql`select email, phone, tenant_id from demo_user where id = ${id}`);
    const row = rows[0] as { email: string; phone: string | null; tenant_id: string | null } | undefined;
    return row ? { email: row.email, phone: row.phone ?? undefined, tenantId: row.tenant_id } : null;
  }
}

/** notification's `NotificationTenantDirectory` — every tenant with people in `demo_user`, for the coverage check. */
@Injectable()
export class DemoTenantDirectory implements NotificationTenantDirectory {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async listTenantIds(): Promise<string[]> {
    const { rows } = await this.db.execute(sql`select distinct tenant_id from demo_user where tenant_id is not null order by 1`);
    return rows.map((r) => String((r as { tenant_id: string }).tenant_id));
  }
}

@Module({
  imports: [DatabaseModule],
  providers: [DemoContactResolver, DemoTenantDirectory],
  exports: [DemoContactResolver, DemoTenantDirectory],
})
export class DemoNotificationDirectoryModule {}
