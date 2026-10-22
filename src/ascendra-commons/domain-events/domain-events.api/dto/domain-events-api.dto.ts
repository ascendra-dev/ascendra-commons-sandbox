/**
 * Request shapes for `domain-events.api`. Plain interfaces — `ascendra-commons`
 * carries no validation library. The controller reads query strings; the `.api`
 * service validates and parses them.
 */
export interface DeliveryQueryDto {
  eventName?: string;
  /** `emit` / `emitCritical` — the service rejects anything else with a 400. */
  method?: string;
  /** `delivered` / `no_listeners` / `dispatch_failed` — validated likewise. */
  status?: string;
  correlationId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
  /** `asc` / `desc` — validated likewise. */
  order?: string;
}
