/**
 * Request shapes for `background-jobs.api`. Plain interfaces — `ascendra-commons`
 * carries no validation library. The controller reads query strings as given;
 * the `.api` service validates and parses them (a bad value is a 400).
 */
export interface RunHistoryQueryDto {
  jobName?: string;
  outcome?: string;
  trigger?: string;
  /** `'true'` / `'false'`. */
  hasFailedItems?: string;
  correlationId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
  order?: string;
}
