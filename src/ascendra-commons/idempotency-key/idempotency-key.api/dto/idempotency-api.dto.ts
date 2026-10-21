/**
 * Request shapes for `idempotency-key.api`. Plain interfaces — `ascendra-commons`
 * carries no validation library. The controller reads query strings; the `.api`
 * service parses dates.
 */
export interface ClaimQueryDto {
  status?: 'pending' | 'completed';
  scope?: string;
  route?: string;
  correlationId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}
