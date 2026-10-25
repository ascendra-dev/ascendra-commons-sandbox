import type { NotificationChannel } from '../../notification.core';

/**
 * Request shapes for `notification.api`. Plain interfaces — `ascendra-commons`
 * carries no validation library. Controllers apply light structural checks; the
 * `.api` services apply the actor-scoped rules.
 */

/** As it arrives — the service validates each field (a bad one is a 400). */
export interface DeliveryHistoryQueryDto {
  notificationType?: string;
  channel?: string;
  tenantId?: string;
  recipientRef?: string;
  /** `user:<id>` or a hashed address, as a delivery row carries it. */
  recipientKey?: string;
  /** An email or phone number — hashed before the query; needs `recipientHashKey`. */
  recipientAddress?: string;
  status?: string;
  correlationId?: string;
  /** A reason's code — `template_not_found`. */
  reason?: string;
  /** `'true'` = test sends only, `'false'` = real sends only. */
  test?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

export interface SetChannelRouteBody {
  notificationType: string;
  /** `null` = deployment default (platform admin only). */
  tenantId: string | null;
  channels: NotificationChannel[];
}

export interface SetTemplateBody {
  channel: NotificationChannel;
  notificationType: string;
  tenantId: string | null;
  subject?: string | null;
  body: string;
  isHtml?: boolean;
}

export interface SetProviderCredentialBody {
  channel: NotificationChannel;
  /** A tenant's own account, or `null` for the platform's (platform admins only). */
  tenantId: string | null;
  config: Record<string, unknown>;
}

export interface DeliveryStatsQueryDto {
  /** Non-platform actors are restricted to their own tenant regardless of this value. */
  tenantId?: string;
  /** e.g. `'24h'` (rolling), `'7d'`, `'30d'` (whole calendar days in `tz`). Default `'7d'`. */
  window?: string;
  /** IANA zone the days are counted in. Default `'UTC'`. */
  tz?: string;
}

export interface PreviewTemplateBody {
  /** A declared type: its variables are checked, its samples fill what `variables` leaves out. */
  notificationType?: string;
  subject?: string;
  body: string;
  isHtml?: boolean;
  variables?: Record<string, string | number>;
}

export interface TestSendBody {
  recipient: { type: 'user'; id: string } | { type: 'raw'; email?: string; phone?: string };
  notificationType: string;
  variables?: Record<string, string | number>;
  /** Omit to use the caller's own tenant; if given it must equal the caller's tenant (unless platform admin). */
  tenantId?: string | null;
}
