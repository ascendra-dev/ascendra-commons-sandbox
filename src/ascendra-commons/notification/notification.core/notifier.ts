import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CredentialCheck,
  NotificationChannel,
  NotificationChannelResult,
  NotificationRequest,
  NotificationResult,
} from './notification.types';
import { NotificationConfig } from './notification-config.port';
import type { DeliveryAttempt, NotificationDeliveryRecorder } from './notification-delivery-recorder.port';
import { NoopNotificationDeliveryRecorder } from './noop-notification-delivery-recorder';
import { NotificationSender } from './notification-sender.port';
import { recipientRef } from './recipient-ref';
import { recipientKey, type NotificationRecipientHasher } from './recipient-hasher';
import type { NotificationSuppressionList } from './notification-suppression.port';
import type { DedupeClaim, NotificationDeduplicator } from './notification-deduplicator.port';
import type { NotificationPreferences } from './notification-preferences.port';
import type { NotificationTypeDefinition } from './notification-type';
import {
  NOTIFICATION_CHANNEL_SENDERS,
  NOTIFICATION_CONFIG,
  NOTIFICATION_DEDUPE_WINDOW_MS,
  NOTIFICATION_DEDUPLICATOR,
  NOTIFICATION_DELIVERY_RECORDER,
  NOTIFICATION_PREFERENCES,
  NOTIFICATION_RECIPIENT_HASHER,
  NOTIFICATION_SUPPRESSION_LIST,
  NOTIFICATION_TYPES,
} from './tokens';

/** Carries the full NotificationResult so a caller catching this can still see per-channel detail. */
export class NotificationDeliveryError extends Error {
  constructor(public readonly result: NotificationResult) {
    super(`Notification delivery ${result.status}`);
  }
}

/**
 * A class, not an interface — this has exactly one implementation with real
 * behavior worth having directly. notify() retrieves the configured channels,
 * calls send() on each one's registered NotificationSender in parallel, and
 * aggregates: 'sent' only if every channel sent, 'failed' only if every
 * channel failed, 'partial' otherwise — always with the full per-channel
 * breakdown attached in `channels`, so a caller checking only `status` gets a
 * safe answer and one that wants to know exactly which channel failed can look.
 */
@Injectable()
export class Notifier {
  private readonly logger = new Logger(Notifier.name);
  private readonly deliveryRecorder: NotificationDeliveryRecorder;
  /** Types a user can't opt out of. */
  private readonly required: ReadonlySet<string>;

  constructor(
    @Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig,
    @Inject(NOTIFICATION_CHANNEL_SENDERS) private readonly senders: Map<NotificationChannel, NotificationSender>,
    @Optional() @Inject(NOTIFICATION_DELIVERY_RECORDER) deliveryRecorder?: NotificationDeliveryRecorder,
    @Optional() @Inject(NOTIFICATION_RECIPIENT_HASHER) private readonly hasher: NotificationRecipientHasher | null = null,
    @Optional() @Inject(NOTIFICATION_SUPPRESSION_LIST) private readonly suppressions: NotificationSuppressionList | null = null,
    @Optional() @Inject(NOTIFICATION_DEDUPLICATOR) private readonly deduplicator: NotificationDeduplicator | null = null,
    @Optional() @Inject(NOTIFICATION_DEDUPE_WINDOW_MS) private readonly dedupeWindowMs: number = 24 * 60 * 60 * 1000,
    @Optional() @Inject(NOTIFICATION_PREFERENCES) private readonly preferences: NotificationPreferences | null = null,
    @Optional() @Inject(NOTIFICATION_TYPES) types: readonly NotificationTypeDefinition[] = [],
  ) {
    this.required = new Set(types.filter((t) => t.required).map((t) => t.name));
    // NotificationModule.forRoot() always binds the token; the fallback keeps
    // `new Notifier(config, senders)` (tests, ad hoc wiring) working.
    this.deliveryRecorder = deliveryRecorder ?? new NoopNotificationDeliveryRecorder();
  }

  async notify(request: NotificationRequest): Promise<NotificationResult> {
    const dedupeKey = this.dedupeKeyOf(request);
    if (dedupeKey) {
      const claim = await this.claim(dedupeKey);
      // Sent already (or being sent) under this key — nothing goes out again; the first call's result comes back.
      if (!claim.claimed) return claim.prior ?? { status: 'skipped', reason: 'duplicate_in_flight', channels: {} };
      const result = await this.send(request);
      try {
        await this.deduplicator!.complete(dedupeKey, result);
      } catch (err) {
        this.logger.warn(`dedupe: storing the result of "${dedupeKey}" failed — ${err instanceof Error ? err.message : String(err)}`);
      }
      return result;
    }
    return this.send(request);
  }

  /** A usable key with a deduplicator bound — else none (a key over 256 characters or with a NUL is ignored, logged). */
  private dedupeKeyOf(request: NotificationRequest): string | null {
    const key = request.dedupeKey;
    if (!key || !this.deduplicator) return null;
    if (key.length > 256 || key.includes('\u0000')) {
      this.logger.warn(`dedupe: key ignored — at most 256 characters, no NUL ("${key.slice(0, 40)}…")`);
      return null;
    }
    return key;
  }

  /** A failing store mustn't stop the notification — a rare duplicate beats a lost send. */
  private async claim(key: string): Promise<DedupeClaim> {
    try {
      return await this.deduplicator!.claim(key, this.dedupeWindowMs);
    } catch (err) {
      this.logger.warn(`dedupe: claiming "${key}" failed — sending anyway: ${err instanceof Error ? err.message : String(err)}`);
      return { claimed: true };
    }
  }

  private async send(request: NotificationRequest): Promise<NotificationResult> {
    let channels: NotificationChannel[];
    try {
      channels = await this.config.channelsFor(request.notificationType, request.tenantId ?? null);
    } catch (err) {
      // Backstop for a NotificationConfig implementation that can fail (e.g. a
      // database-backed one) — notify()'s "never throws" contract has to hold
      // here too, not just inside dispatch()'s per-channel calls.
      return {
        status: 'failed',
        reason: err instanceof Error ? err.message : 'channel_config_unavailable',
        channels: {},
      };
    }

    if (channels.length === 0) {
      return { status: 'failed', reason: 'no_channel_configured', channels: {} };
    }
    // A retry of one channel: only those asked for, of the ones routed — never one the type isn't routed to.
    if (request.channels) {
      channels = channels.filter((c) => request.channels!.includes(c));
      if (channels.length === 0) return { status: 'failed', reason: 'channel_not_routed', channels: {} };
    }

    const entries = await Promise.all(
      channels.map((channel): Promise<[NotificationChannel, NotificationChannelResult]> => this.dispatch(channel, request)),
    );

    // `rendered` is plumbing from the sender to the delivery log only — never surfaced
    // in the public result (it is full-fidelity, PII-bearing message text).
    const channelResults = Object.fromEntries(
      entries.map(([channel, { rendered: _rendered, ...pub }]) => [channel, pub]),
    ) as Partial<Record<NotificationChannel, NotificationChannelResult>>;
    // Over the channels that were tried — a skipped one (suppressed, opted out) is neither a success nor a failure.
    const tried = entries.filter(([, result]) => result.status !== 'skipped');
    const sentCount = tried.filter(([, result]) => result.status === 'sent').length;
    const status: NotificationResult['status'] =
      tried.length === 0 ? 'skipped' : sentCount === tried.length ? 'sent' : sentCount === 0 ? 'failed' : 'partial';

    await this.recordDelivery(request, entries);
    return { status, channels: channelResults };
  }

  /**
   * Best-effort — a failure to write the delivery log is swallowed and logged,
   * never allowed to change the notification's own outcome (contrast
   * audit-logging, where a failed write is critical). The recorder itself is
   * also contractually non-throwing; this is the belt-and-braces.
   */
  private async recordDelivery(
    request: NotificationRequest,
    entries: Array<[NotificationChannel, NotificationChannelResult]>,
  ): Promise<void> {
    const now = new Date();
    const attempts: DeliveryAttempt[] = entries.map(([channel, result]) => ({
      notificationType: request.notificationType,
      channel,
      tenantId: request.tenantId ?? null,
      recipientRef: recipientRef(request.recipient),
      recipientKey: recipientKey(channel, request.recipient, this.hasher),
      status: result.status,
      reason: result.reason,
      providerMessageId: result.providerMessageId,
      attemptedAt: now,
      correlationId: request.correlationId,
      test: request.test ?? false,
      retryOf: request.retryOf,
      content: result.rendered
        ? {
            subject: result.rendered.subject ?? null,
            body: result.rendered.body,
            isHtml: result.rendered.isHtml ?? false,
            variables: request.variables,
          }
        : undefined,
    }));
    try {
      await this.deliveryRecorder.recordAttempts(attempts);
    } catch (err) {
      this.logger.error(
        `notify("${request.notificationType}") delivered, but recording the delivery log failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Like notify(), but can throw — the emitCritical() counterpart to notify()'s
   * emit()-like "never throw" contract. Reuses notify() rather than duplicating
   * dispatch/aggregation; only the throw decision is new here.
   *
   * strict = false (default): throws only when every configured channel
   * failed — as long as at least one channel got through, this returns
   * normally instead of throwing.
   * strict = true: throws when any configured channel failed — only a fully
   * 'sent' result returns normally.
   *
   * Either way, when it throws, the exception carries the full NotificationResult
   * (see NotificationDeliveryError) so a caller that wants the per-channel
   * detail can still read it, even though delivery is being surfaced as a failure.
   */
  async notifyCritical(request: NotificationRequest, strict = false): Promise<NotificationResult> {
    const result = await this.notify(request);
    // A skip is deliberate (suppressed, opted out) — never an error.
    const shouldThrow = strict ? result.status === 'failed' || result.status === 'partial' : result.status === 'failed';
    if (shouldThrow) {
      throw new NotificationDeliveryError(result);
    }
    return result;
  }

  /** A user's own opt-out — never for a `required` type, never for a guest. A broken store means "send". */
  private async isOptedOut(channel: NotificationChannel, request: NotificationRequest): Promise<boolean> {
    if (!this.preferences || request.recipient.type !== 'user' || this.required.has(request.notificationType)) return false;
    try {
      return await this.preferences.isOptedOut(request.recipient.id, request.notificationType, channel);
    } catch (err) {
      this.logger.warn(`preferences check failed for ${channel} — sending anyway: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** A broken suppression list mustn't stop every notification — on an error, the send goes ahead. */
  private async isSuppressed(channel: NotificationChannel, request: NotificationRequest): Promise<boolean> {
    const key = this.suppressions ? recipientKey(channel, request.recipient, this.hasher) : null;
    if (!key) return false;
    try {
      return await this.suppressions!.isSuppressed(channel, key);
    } catch (err) {
      this.logger.warn(`suppression check failed for ${channel} — sending anyway: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Does the credential a send on `channel` for `tenantId` would use work? Reads it the way a send does (the tenant's
   * own, the platform's for a tenantless send or as the fallback) and asks the channel's sender to check it — at most
   * 10 s. Never throws.
   */
  async verifyCredential(channel: NotificationChannel, tenantId: string | null): Promise<CredentialCheck> {
    const sender = this.senders.get(channel);
    if (!sender?.verify) return { supported: false, detail: `the ${channel} sender can't check a credential` };
    try {
      const credential = await this.config.providerConfigFor(channel, tenantId);
      if (!credential) return { supported: true, ok: false, detail: 'no credential to check' };
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<{ ok: boolean; detail: string }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, detail: 'the provider did not answer within 10 s' }), 10_000);
      });
      const answer = await Promise.race([sender.verify(credential), timeout]).finally(() => clearTimeout(timer));
      return { supported: true, ...answer };
    } catch (err) {
      return { supported: true, ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async dispatch(
    channel: NotificationChannel,
    request: NotificationRequest,
  ): Promise<[NotificationChannel, NotificationChannelResult]> {
    const sender = this.senders.get(channel);
    if (!sender) {
      return [channel, { status: 'failed', reason: 'channel_not_registered' }];
    }

    if (await this.isOptedOut(channel, request)) return [channel, { status: 'skipped', reason: 'opted_out' }];
    if (await this.isSuppressed(channel, request)) return [channel, { status: 'skipped', reason: 'suppressed' }];

    try {
      const result = await sender.send(request);
      return [channel, result];
    } catch (err) {
      // Backstop for a sender that forgot to catch its own error — the same
      // lesson as domain-events' emit(): one channel's exception must never
      // crash the whole notify() dispatch.
      return [channel, { status: 'failed', reason: err instanceof Error ? err.message : 'unknown_error' }];
    }
  }
}
