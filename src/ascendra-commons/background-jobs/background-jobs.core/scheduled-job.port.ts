/**
 * A unit of scheduled, unattended work. Carries no knowledge of what "due" or
 * "processed" mean for any particular use case — that's entirely the
 * implementer's concern. IdempotentJobRunner only orchestrates: acquire a
 * lock keyed by `name`, call findDueItems(), call processItem() once per
 * item, isolate failures per item.
 */
export interface ScheduledJob<TItem> {
  /**
   * Unique across every job in the application — becomes the advisory lock
   * key (`scheduler:{name}`). A typo here silently creates a second,
   * uncoordinated lock rather than sharing the intended one; keep job names
   * in one const catalog, the same convention Actions uses in the
   * authorization pattern.
   */
  readonly name: string;

  /** "What needs processing right now." The runner never inspects the result — only iterates it. */
  findDueItems(): Promise<TItem[]>;

  /**
   * Do the work for exactly one item, including whatever marks that item as
   * done. Must be safe to never be called again for an item once this
   * resolves, and safe to be retried for an item that never got this far —
   * that safety is this method's own responsibility to build (typically: do
   * the side effect, then persist a per-item "done" marker last, so a crash
   * before the marker commits leaves the item correctly due again).
   */
  processItem(item: TItem): Promise<void>;

  /**
   * Optional. A short, log-safe identifier for one item — an id or reference,
   * never PII and never the whole row. Used only to name the item in the
   * runner's per-item failure log, so a failure in a large batch is
   * diagnosable ("failed on invoice a1b2" rather than "failed on one item").
   * If omitted, the runner logs the item's position in the batch instead.
   * A throw here is swallowed — it can never turn a logging concern into a
   * batch failure.
   */
  describeItem?(item: TItem): string;
}
