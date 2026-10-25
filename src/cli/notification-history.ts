import { sql } from 'drizzle-orm';
import {
  recipientKey,
  renderTemplate,
  type DeliveryAttempt,
  type NotificationChannel,
  type NotificationRecipient,
  type NotificationRecipientHasher,
  type Notifier,
} from '../ascendra-commons/notification/notification.core';
import {
  seedNotificationConfigFromData,
  type PostgresNotificationDeliveryRecorder,
  type PostgresNotificationRetentionService,
  type SqlExecutor,
} from '../ascendra-commons/notification/notification.core.database.postgres-drizzle';
import type { Database } from '../db/database.module';
import { NOTIFICATION_DEFAULTS } from '../demo/demo-notifications';
import { CUSTOMERS, PLATFORM_ADMIN, TENANTS } from './cast';
import type { Rng } from './rng';

/**
 * Generates notification history — config, ninety days of deliveries, and what's happening now. Three parts, because
 * a delivery's time can't be set through the module's front door:
 *
 * 1. **Config** — the defaults the product ships (`seedNotificationConfigFromData`, as a deploy step would), then each
 *    tenant's own changes over HTTP as its admin (`PUT /notifications/config/*` — validated and audited, as in life):
 *    Acme brings its own email account, white-labels `invoice.sent` and turns SMS reminders off; Globex adds an SMS key
 *    that turns out revoked; Meridian routes `payment.confirmed` to SMS with no SMS template. Plus one row no endpoint
 *    allows: a leftover route for `invoice.overdue`, a type an older release declared.
 * 2. **The past** — `Notifier` stamps `attemptedAt` with the real clock, so 90 days of sends can't be made through it.
 *    Each one is written through the module's own write entry point instead — the real buffered
 *    `PostgresNotificationDeliveryRecorder`, with what `Notifier` would have recorded (the same channels, rendered
 *    templates, keyed recipients) — and provider callbacks through its `updateDeliveryStatus` (delivered, bounced; a
 *    hard bounce suppressed). Past in-app sends are logged but have no inbox item: the inbox stamps its own time.
 * 3. **Now** — real sends through `Notifier` and the HTTP API: in-app messages, a tenantless alert to platform staff,
 *    a user's preferences, a deduplicated send, a suppressed guest, a test send, a retry, a message read.
 *
 * Finally the retention job's content step clears stored messages older than 30 days, as the nightly job would.
 *
 * The story: Umbrella Labs' billing address is rejected outright; Hooli's bounced and was suppressed 40 days ago;
 * Cyberdyne has no phone on file. Globex's own SMS key (added 10 days ago) is revoked — every Globex SMS since failed.
 * Meridian's SMS route for `payment.confirmed` (6 days ago) has no template. The `kyc-expiry-scan` job has failed every
 * day for 5 days (job-history.ts's story) and told platform staff each time.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const APPLICATION = process.env.APPLICATION ?? 'ascendra-commons-sandbox';

export interface NotificationHistoryTotals {
  recorded: number;
  callbacks: number;
  liveSends: number;
}

/** A guest payer — an address the invoice carries, no account. */
interface Payer {
  name: string;
  email: string;
  phone?: string;
}

/** How the delivery log names a recipient — `user:<id>`, or `raw:email` / `raw:phone` (never the address). */
const recipientRef = (r: NotificationRecipient) => (r.type === 'user' ? `user:${r.id}` : r.email ? 'raw:email' : r.phone ? 'raw:phone' : 'raw');

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const COUNTRY_PREFIX: Record<string, string> = { PK: '+92300', GB: '+447700', US: '+1555' };

const PAYERS: Payer[] = CUSTOMERS.map((c, i) => {
  if (c.name === 'Umbrella Labs') return { name: c.name, email: 'ap-invalid@umbrella-labs.test', phone: '+15550104' };
  if (c.name === 'Hooli Retail') return { name: c.name, email: 'accounts.bounce@hooli-retail.test', phone: '+15550109' };
  if (c.name === 'Cyberdyne Systems') return { name: c.name, email: 'billing@cyberdyne-systems.test' };
  return { name: c.name, email: `billing@${slug(c.name)}.test`, phone: `${COUNTRY_PREFIX[c.address.country] ?? '+1555'}${String(1000000 + i * 7919).slice(0, 7)}` };
});

const HOOLI_SUPPRESSED_DAYS_AGO = 40;
const GLOBEX_KEY_DAYS_AGO = 10;
const MERIDIAN_SMS_ROUTE_DAYS_AGO = 6;
const ACME_REMINDER_ROUTE_DAYS_AGO = 20;
const KYC_BROKEN_DAYS_AGO = 5;
/** Acme's finance lead — she turned SMS off. */
const OPTED_OUT_USER = 'hana.ito@acme.test';

export class NotificationHistory {
  private readonly totals: NotificationHistoryTotals = { recorded: 0, callbacks: 0, liveSends: 0 };
  private readonly callbacks: Array<{ providerMessageId: string; status: 'delivered' | 'bounced'; detail?: string; suppress?: boolean }> = [];
  private readonly tokens = new Map<string, string>();
  private invoiceSeq = 1000;
  /** Each tenant's people (demo_user, made by the access history) — who staff notifications go to. */
  private staff = new Map<string, string[]>();

  constructor(
    private readonly baseUrl: string,
    private readonly db: Database,
    private readonly recorder: PostgresNotificationDeliveryRecorder,
    private readonly retention: PostgresNotificationRetentionService,
    private readonly notifier: Notifier,
    private readonly hasher: NotificationRecipientHasher,
    private readonly rng: Rng,
  ) {}

  async run(options: { days: number; until: Date }): Promise<NotificationHistoryTotals> {
    await this.givePhones();
    await this.loadStaff();
    await this.config();
    await this.past(options.days, options.until.getTime());
    await this.now();
    // The nightly retention job's first step — stored messages kept 30 days.
    await this.retention.clearContent(new Date(options.until.getTime() - 30 * DAY));
    return this.totals;
  }

  // ---- 1. config ----

  /** demo_user is the sandbox's own table: most people get a phone (SMS and WhatsApp need one); some never gave one. */
  private async givePhones() {
    const { rows } = await this.db.execute(sql`select id from demo_user order by id`);
    for (const [i, row] of rows.entries()) {
      if (i % 4 === 3) continue;
      await this.db.execute(sql`update demo_user set phone = ${`+1555${String(2000000 + i * 104729).slice(0, 7)}`} where id = ${row.id as string}`);
    }
  }

  private async loadStaff() {
    const { rows } = await this.db.execute(sql`
      select tenant_id, id from demo_user where tenant_id is not null and id not like 'admin@%' and id not like 'member@%' order by id`);
    for (const row of rows) {
      const list = this.staff.get(row.tenant_id as string) ?? [];
      list.push(row.id as string);
      this.staff.set(row.tenant_id as string, list);
    }
  }

  private staffOf(tenantId: string): string[] {
    return this.staff.get(tenantId) ?? [];
  }

  private async config() {
    // The product's defaults — a deploy step, idempotent.
    await seedNotificationConfigFromData(this.db as unknown as SqlExecutor, APPLICATION, NOTIFICATION_DEFAULTS);
    // A leftover: a type an older release declared and this one doesn't — no endpoint would accept it now.
    await this.db.execute(sql`
      insert into commons_notification_channel_route (application, notification_type, tenant_id, channels)
      values (${APPLICATION}, 'invoice.overdue', null, array['email']::text[])
      on conflict do nothing
    `);

    // Each tenant's own changes, through the API as its admin.
    await this.put('admin@acme.test', '/notifications/config/credentials', {
      channel: 'email', tenantId: 'tenant_acme', config: { provider: 'fake-ses', apiKey: 'acme-email-key', from: 'billing@acme.test' },
    });
    await this.put('admin@acme.test', '/notifications/config/templates', {
      channel: 'email', notificationType: 'invoice.sent', tenantId: 'tenant_acme',
      subject: 'Acme Holdings — invoice {{invoiceNumber}}',
      body: 'Dear {{customerName}},\n\nYour Acme Holdings invoice {{invoiceNumber}} for {{amount}} {{currency}} is attached. Due {{dueDate}}.\n\nAcme Holdings Billing',
    });
    await this.put('admin@acme.test', '/notifications/config/routes', { notificationType: 'invoice.reminder', tenantId: 'tenant_acme', channels: ['email'] });
    await this.put('admin@globex.test', '/notifications/config/credentials', {
      channel: 'sms', tenantId: 'tenant_globex', config: { provider: 'fake-twilio', apiKey: 'revoked', from: '+15550301' },
    });
    await this.put('admin@meridian.test', '/notifications/config/routes', {
      notificationType: 'payment.confirmed', tenantId: 'tenant_meridian', channels: ['email', 'sms'],
    });
  }

  // ---- 2. the past ----

  private async past(days: number, until: number) {
    const from = until - days * DAY;
    for (let day = 0; day < days; day++) {
      const dayStart = from + day * DAY;
      for (const tenant of TENANTS) {
        const invoices = Math.max(1, tenant.dailyInvoices + this.rng.int(-2, 2));
        for (let i = 0; i < invoices; i++) this.invoice(tenant, dayStart + this.rng.int(8, 18) * HOUR + this.rng.int(0, 59) * 60_000, until);
        const people = this.staffOf(tenant.id);
        if (this.rng.chance(0.3) && people.length > 0) {
          // Acme's payouts go to its finance lead, hana.ito — who has SMS turned off.
          const finance = tenant.id === 'tenant_acme' ? OPTED_OUT_USER : this.rng.pick(people);
          this.record(tenant.id, { type: 'user', id: finance }, 'payout.approved', {
            amount: this.money(), currency: tenant.currency, approvedBy: tenant.admin.name,
          }, dayStart + 15 * HOUR, until);
        }
        if (day % 7 === 3) this.record(tenant.id, { type: 'user', id: tenant.admin.id }, 'report.ready', { reportName: 'Weekly statements' }, dayStart + 6 * HOUR, until);
        if (this.rng.chance(0.05) && people.length > 0) {
          const person = this.rng.pick(people);
          this.record(tenant.id, { type: 'user', id: person }, 'password.reset', { resetLink: `https://app.example.test/reset/${this.rng.uuid().slice(0, 8)}` }, dayStart + 11 * HOUR, until);
        }
        if (this.rng.chance(0.04) && people.length > 0) {
          const person = this.rng.pick(people);
          this.record(tenant.id, { type: 'user', id: person }, 'role.assigned', { roleName: 'billing-clerk', grantedBy: tenant.admin.name }, dayStart + 10 * HOUR, until);
        }
        // An admin checking a template now and then — a test send, left out of the stats.
        if (this.rng.chance(0.03)) {
          this.record(tenant.id, { type: 'user', id: tenant.admin.id }, 'invoice.sent', this.invoiceVars(tenant, this.rng.pick(PAYERS)), dayStart + 9 * HOUR, until, { test: true });
        }
      }
      // kyc-expiry-scan broke 5 days ago — platform staff were told every day (no tenant).
      if (until - (dayStart + DAY) < KYC_BROKEN_DAYS_AGO * DAY) {
        this.record(null, { type: 'user', id: PLATFORM_ADMIN }, 'job.failed', {
          jobName: 'kyc-expiry-scan', error: 'connection pool exhausted — timeout acquiring a client after 5000ms',
        }, dayStart + 2 * HOUR + 30 * 60_000, until);
      }
    }
    await this.recorder.flush();
    // The provider's callbacks — what a webhook controller would pass to updateDeliveryStatus.
    for (const cb of this.callbacks) await this.recorder.updateDeliveryStatus(cb);
    this.totals.callbacks = this.callbacks.length;
  }

  /** One invoice: sent, sometimes reminded, usually paid. */
  private invoice(tenant: (typeof TENANTS)[number], at: number, until: number) {
    const payer = this.rng.pick(PAYERS);
    const vars = this.invoiceVars(tenant, payer);
    const recipient: NotificationRecipient = { type: 'raw', email: payer.email, phone: payer.phone };
    this.record(tenant.id, recipient, 'invoice.sent', vars, at, until);
    if (this.rng.chance(0.35)) {
      this.record(tenant.id, recipient, 'invoice.reminder', { ...vars, daysOverdue: this.rng.int(1, 9) }, at + this.rng.int(3, 10) * DAY, until);
    }
    if (this.rng.chance(0.7)) {
      this.record(tenant.id, recipient, 'payment.confirmed', vars, at + this.rng.int(1, 14) * DAY + this.rng.int(0, 5) * HOUR, until);
    }
  }

  /** What Notifier would have recorded for one send at `at` — one attempt per routed channel. */
  private record(
    tenantId: string | null,
    recipient: NotificationRecipient,
    type: string,
    variables: Record<string, string | number>,
    at: number,
    until: number,
    extra: { test?: boolean } = {},
  ) {
    if (at >= until) return;
    const attemptedAt = new Date(at);
    const correlationId = this.rng.uuid();
    const attempts: DeliveryAttempt[] = this.channelsFor(tenantId, type, until - at).map((channel) => {
      const outcome = this.outcome(tenantId, recipient, type, channel, until - at);
      const template = this.templateFor(tenantId, type, channel);
      const rendered = outcome.status === 'sent' && template ? renderTemplate(template, variables) : undefined;
      const providerMessageId = outcome.status === 'sent' && channel !== 'in_app' ? `${this.provider(channel)}-${this.rng.uuid().slice(0, 12)}` : undefined;
      if (providerMessageId && !extra.test) this.callback(recipient, channel, providerMessageId, until - at);
      return {
        notificationType: type,
        channel,
        tenantId,
        recipientRef: recipientRef(recipient),
        recipientKey: recipientKey(channel, recipient, this.hasher),
        status: outcome.status,
        reason: outcome.reason,
        providerMessageId: channel === 'in_app' && outcome.status === 'sent' ? `inbox:${this.rng.int(1, 999999)}` : providerMessageId,
        attemptedAt,
        correlationId,
        test: extra.test,
        // As Notifier records it: the rendered message — or, for a failed send, its variables alone (a retry needs them).
        content: rendered
          ? { subject: rendered.subject ?? null, body: rendered.body, isHtml: false, variables }
          : outcome.status === 'failed'
            ? { subject: null, body: null, isHtml: false, variables }
            : undefined,
      };
    });
    void this.recorder.recordAttempts(attempts);
    this.totals.recorded += attempts.length;
  }

  /** The routing in force `ago` ms before now — tenant changes only count from the day they were made. */
  private channelsFor(tenantId: string | null, type: string, ago: number): NotificationChannel[] {
    if (tenantId === 'tenant_acme' && type === 'invoice.reminder' && ago < ACME_REMINDER_ROUTE_DAYS_AGO * DAY) return ['email'];
    if (tenantId === 'tenant_meridian' && type === 'payment.confirmed' && ago < MERIDIAN_SMS_ROUTE_DAYS_AGO * DAY) return ['email', 'sms'];
    return NOTIFICATION_DEFAULTS.channels[type] ?? [];
  }

  private templateFor(tenantId: string | null, type: string, channel: NotificationChannel) {
    if (tenantId === 'tenant_acme' && type === 'invoice.sent' && channel === 'email') {
      return {
        subject: 'Acme Holdings — invoice {{invoiceNumber}}',
        body: 'Dear {{customerName}},\n\nYour Acme Holdings invoice {{invoiceNumber}} for {{amount}} {{currency}} is attached. Due {{dueDate}}.\n\nAcme Holdings Billing',
      };
    }
    return NOTIFICATION_DEFAULTS.templates?.[channel]?.[type] ?? null;
  }

  /** What happened to one channel's send — the story's failures, the rest sent. */
  private outcome(
    tenantId: string | null,
    recipient: NotificationRecipient,
    type: string,
    channel: NotificationChannel,
    ago: number,
  ): { status: 'sent' | 'failed' | 'skipped'; reason?: string } {
    const email = recipient.type === 'raw' ? recipient.email : undefined;
    const phone = recipient.type === 'raw' ? recipient.phone : 'user-phone';
    if (channel === 'email' && email?.includes('bounce') && ago < HOOLI_SUPPRESSED_DAYS_AGO * DAY) return { status: 'skipped', reason: 'suppressed' };
    if (channel === 'email' && email?.includes('invalid')) return { status: 'failed', reason: 'provider_rejected: 550 recipient address rejected' };
    if ((channel === 'sms' || channel === 'whatsapp') && !phone) return { status: 'failed', reason: 'no_address_available' };
    if (channel === 'sms' && tenantId === 'tenant_globex' && ago < GLOBEX_KEY_DAYS_AGO * DAY) return { status: 'failed', reason: 'provider_auth_failed: 401 invalid api key' };
    // hana.ito@acme.test turned SMS off — every SMS to her is skipped (Notifier asks before the sender runs).
    if (channel === 'sms' && recipient.type === 'user' && recipient.id === OPTED_OUT_USER) return { status: 'skipped', reason: 'opted_out' };
    if (channel === 'sms' && !this.templateFor(tenantId, type, channel)) return { status: 'failed', reason: 'template_not_found' };
    // Now and then a provider times out — transient; the kind a retry fixes. (In-app has no provider to time out.)
    if (channel !== 'in_app' && this.rng.chance(0.015)) return { status: 'failed', reason: 'provider_timeout: no answer within 10s' };
    return { status: 'sent' };
  }

  /** The provider reports back on most accepted messages: delivered — or, for Hooli's dead mailbox, bounced. */
  private callback(recipient: NotificationRecipient, channel: NotificationChannel, providerMessageId: string, ago: number) {
    const email = recipient.type === 'raw' ? recipient.email : undefined;
    if (channel === 'email' && email?.includes('bounce')) {
      // The first hard bounce suppressed the address — later sends to it were skipped.
      const first = ago >= HOOLI_SUPPRESSED_DAYS_AGO * DAY && ago < (HOOLI_SUPPRESSED_DAYS_AGO + 3) * DAY;
      this.callbacks.push({ providerMessageId, status: 'bounced', detail: '550 5.1.1 mailbox unavailable', suppress: first });
      return;
    }
    if (channel === 'email' && this.rng.chance(0.01)) {
      this.callbacks.push({ providerMessageId, status: 'bounced', detail: '452 mailbox full — soft bounce' });
      return;
    }
    if (this.rng.chance(0.85)) this.callbacks.push({ providerMessageId, status: 'delivered' });
  }

  private provider(channel: NotificationChannel): string {
    return { email: 'fake-ses', sms: 'fake-twilio', whatsapp: 'fake-meta', in_app: 'inbox' }[channel];
  }

  private invoiceVars(tenant: (typeof TENANTS)[number], payer: Payer): Record<string, string | number> {
    this.invoiceSeq += 1;
    return {
      customerName: payer.name,
      invoiceNumber: `INV-${tenant.id.replace('tenant_', '').slice(0, 3).toUpperCase()}-${this.invoiceSeq}`,
      amount: this.money(),
      currency: tenant.currency,
      dueDate: '2026-11-15',
    };
  }

  private money(): string {
    return (this.rng.int(120, 48000) + this.rng.int(0, 99) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ---- 3. now ----

  private async now() {
    const live = async (request: Parameters<Notifier['notify']>[0]) => {
      await this.notifier.notify(request);
      this.totals.liveSends += 1;
    };
    // hana.ito@acme.test turns SMS off herself.
    await this.put(OPTED_OUT_USER, '/notifications/preferences/me', { notificationType: '*', channel: 'sms', enabled: false });
    // In-app messages, really delivered into inboxes.
    await live({ recipient: { type: 'user', id: 'member@acme.test' }, notificationType: 'role.assigned', variables: { roleName: 'billing-clerk', grantedBy: 'Ayesha Malik' }, tenantId: 'tenant_acme' });
    await live({ recipient: { type: 'user', id: OPTED_OUT_USER }, notificationType: 'payout.approved', variables: { amount: '18,400.00', currency: 'PKR', approvedBy: 'Ayesha Malik' }, tenantId: 'tenant_acme' });
    for (const tenant of TENANTS) {
      await live({ recipient: { type: 'user', id: tenant.admin.id }, notificationType: 'report.ready', variables: { reportName: 'October statements' }, tenantId: tenant.id });
    }
    // Platform staff, no tenant — the platform's own email account.
    await live({ recipient: { type: 'user', id: PLATFORM_ADMIN }, notificationType: 'job.failed', variables: { jobName: 'kyc-expiry-scan', error: 'connection pool exhausted' }, tenantId: null });
    // The same invoice sent twice (a retried job) — the dedupe key lets one through.
    const resend = { recipient: { type: 'raw' as const, email: 'billing@northwind-traders.test' }, notificationType: 'invoice.sent', variables: { customerName: 'Northwind Traders', invoiceNumber: 'INV-ACM-9001', amount: '2,300.00', currency: 'PKR', dueDate: '2026-11-20' }, tenantId: 'tenant_acme', dedupeKey: 'invoice:INV-ACM-9001:sent' };
    await live(resend);
    await live(resend);
    // Hooli's suppressed address — skipped, not sent.
    await live({ recipient: { type: 'raw', email: 'accounts.bounce@hooli-retail.test' }, notificationType: 'invoice.sent', variables: this.invoiceVars(TENANTS[1], PAYERS.find((p) => p.name === 'Hooli Retail')!), tenantId: 'tenant_globex' });
    await this.recorder.flush();

    // Over HTTP: a test send, a retry of a recent transient failure, a message read, one inbox item read.
    await this.post('admin@acme.test', '/notifications/test-send', { recipient: { type: 'user', id: 'admin@acme.test' }, notificationType: 'role.assigned' });
    const { rows: retryable } = await this.db.execute(sql`
      select id from commons_notification_delivery
      where reason like 'provider_timeout%' and recipient_ref like 'user:%' and content is not null and tenant_id is not null
      order by attempted_at desc limit 1`);
    if (retryable[0]) await this.post(PLATFORM_ADMIN, `/notifications/deliveries/${String(retryable[0].id)}/retry`, {});
    const { rows: readable } = await this.db.execute(sql`
      select id from commons_notification_delivery where content is not null and tenant_id = 'tenant_meridian' order by attempted_at desc limit 1`);
    if (readable[0]) await this.request('GET', PLATFORM_ADMIN, `/notifications/deliveries/${String(readable[0].id)}/content`);
    const inbox = (await this.request('GET', 'member@acme.test', '/notifications/inbox')) as { data: Array<{ id: string }> };
    if (inbox.data?.[0]) await this.post('member@acme.test', `/notifications/inbox/${inbox.data[0].id}/read`, {});
    await this.recorder.flush();
  }

  // ---- HTTP as a signed-in user ----

  private put(actorId: string, path: string, body: unknown) {
    return this.request('PUT', actorId, path, body);
  }

  private post(actorId: string, path: string, body: unknown) {
    return this.request('POST', actorId, path, body);
  }

  private async request(method: string, actorId: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.token(actorId)}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} as ${actorId} → ${res.status} ${text}`);
    return text ? JSON.parse(text) : undefined;
  }

  private async token(actorId: string): Promise<string> {
    const cached = this.tokens.get(actorId);
    if (cached) return cached;
    const res = await fetch(`${this.baseUrl}/dev/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorId }),
    });
    if (!res.ok) throw new Error(`POST /dev/token as ${actorId} → ${res.status} ${await res.text()}`);
    const { token } = (await res.json()) as { token: string };
    this.tokens.set(actorId, token);
    return token;
  }
}
