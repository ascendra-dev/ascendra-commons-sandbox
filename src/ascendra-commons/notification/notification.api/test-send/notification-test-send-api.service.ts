import { BadRequestException, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import {
  NOTIFIER,
  USER_CONTACT_RESOLVER,
  type Notifier,
  type NotificationRecipient,
  type NotificationResult,
  type UserContactResolver,
} from '../../notification.core';
import { NOTIFICATION_API_OPTIONS } from '../tokens';
import type { NotificationApiOptions } from '../notification-api.options';
import type { TestSendBody } from '../dto/notification-api.dto';
import { idParam, tenantParam, textParam, variablesParam } from '../shared/params';
import { NotificationTypeCatalog } from '../types/notification-type-catalog';

/** Long enough for any real address — RFC 5321 caps a path at 256; a phone number is far shorter. */
const MAX_ADDRESS = 256;

/**
 * `POST /notifications/test-send` — fire a real notification through `Notifier`, so an admin can verify a
 * route/template/credential actually works. It goes out through the tenant's real provider, so who it may reach is
 * narrow:
 *
 *  - a **platform admin** — any recipient (a user, or a raw email/phone), any tenant's configuration;
 *  - anyone else — their **own tenant's** configuration, sent to **themselves**, or to a user the app's
 *    `UserContactResolver` says is in their tenant. Never a raw address: a tenant admin with any address and any
 *    variables would be a phishing tool on the tenant's domain.
 *
 * Every test send is marked (`test: true`) — its delivery rows are `is_test`, left out of the stats.
 */
@Injectable()
export class NotificationTestSendApiService {
  constructor(
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(NOTIFICATION_API_OPTIONS) private readonly options: NotificationApiOptions,
    // Optional — without it (NotificationModule not visible here) a tenant admin may test-send to themselves only.
    @Optional() @Inject(USER_CONTACT_RESOLVER) private readonly users?: UserContactResolver,
    @Optional() private readonly types: NotificationTypeCatalog = new NotificationTypeCatalog(),
  ) {}

  async send(actor: Actor, body: TestSendBody): Promise<NotificationResult> {
    const notificationType = idParam('notificationType', body?.notificationType);
    const recipient = recipientParam(body?.recipient);
    this.types.assertKnown(notificationType);
    // A declared type's samples fill whatever the caller leaves out — a test needs no hand-typed values.
    const variables = this.types.withSamples(notificationType, variablesParam('variables', body?.variables));
    const platform = await this.options.isPlatformAdmin(actor);

    let tenantId = actor.tenantId;
    if (body?.tenantId !== undefined) {
      const requested = tenantParam('tenantId', body.tenantId);
      if (requested !== actor.tenantId && !platform) {
        throw new ForbiddenException("cannot test-send against another tenant's configuration");
      }
      tenantId = requested;
    }

    if (!platform) await this.assertReachable(actor, recipient);

    const result = await this.notifier.notify({ recipient, notificationType, variables, tenantId, test: true });
    // The result links to the row in the log — written now, not at the recorder's next flush.
    await this.notifier.flushDeliveryLog();
    return result;
  }

  /** Anyone but a platform admin: themselves, or a user in their own tenant — never a raw address. */
  private async assertReachable(actor: Actor, recipient: NotificationRecipient): Promise<void> {
    if (recipient.type === 'raw') {
      throw new ForbiddenException('only a platform admin may test-send to an address — send it to yourself or a colleague');
    }
    if (recipient.id === actor.id) return;
    const user = this.users ? await this.users.findById(recipient.id) : null;
    if (!user || user.tenantId === undefined || user.tenantId !== actor.tenantId) {
      throw new ForbiddenException('you may test-send to yourself or to a user in your own tenant');
    }
  }
}

function recipientParam(value: unknown): NotificationRecipient {
  if (typeof value !== 'object' || value === null) throw new BadRequestException('"recipient" is required');
  const r = value as Record<string, unknown>;
  if (r.type === 'user') return { type: 'user', id: idParam('recipient.id', r.id) };
  if (r.type === 'raw') {
    const email = textParam('recipient.email', r.email, MAX_ADDRESS);
    const phone = textParam('recipient.phone', r.phone, MAX_ADDRESS);
    if (!email && !phone) throw new BadRequestException('a raw recipient needs "email" or "phone"');
    return { type: 'raw', email, phone };
  }
  throw new BadRequestException('"recipient.type" must be user or raw');
}
