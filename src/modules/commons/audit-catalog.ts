import type { AuditCatalogEntry } from '../../ascendra-commons/audit-logging/audit-logging.api';

/**
 * The sandbox's audit vocabulary — what the sample domain records, per entity type. Served by `GET /audit/catalog`,
 * where it feeds the UI's Entity type / Action filters. Actions are verb-only (`issued`, not `invoice.issued`): the
 * entity type already says what was acted on (audit-logging's README).
 */
export const AUDIT_CATALOG: AuditCatalogEntry[] = [
  { entityType: 'invoice', actions: ['created', 'updated', 'issued', 'paid', 'payment_failed', 'voided'] },
  { entityType: 'payment', actions: ['captured', 'failed', 'refunded'] },
  { entityType: 'user', actions: ['invited', 'profile_updated', 'role_granted', 'role_revoked'] },
  { entityType: 'attachment', actions: ['uploaded', 'deleted'] },
  // notification — the console's config edits, message reads, retries and suppressions
  { entityType: 'channel_route', actions: ['route_set', 'set', 'deleted'] },
  { entityType: 'template', actions: ['set', 'deleted'] },
  { entityType: 'provider_credential', actions: ['set', 'deleted'] },
  { entityType: 'delivery', actions: ['viewed', 'retried'] },
  { entityType: 'suppression', actions: ['removed'] },
  { entityType: 'tenant', actions: ['created', 'plan_changed'] },
  { entityType: 'job', actions: ['triggered'] },
  { entityType: 'user_role', actions: ['assigned', 'revoked'] },
  { entityType: 'delegation', actions: ['granted', 'revoked'] },
  { entityType: 'action_catalog', actions: ['described'] },
];
