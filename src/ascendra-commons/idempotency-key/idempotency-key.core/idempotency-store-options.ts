export interface IdempotencyStoreOptions {
  /**
   * How long a 'pending' claim sits before a later request may reclaim it
   * as abandoned. No safe universal default — this must exceed the
   * realistic worst-case latency of every endpoint it's applied to,
   * including dependency on an external API (a payment gateway's
   * checkout-session call, most concretely). Setting it too low doesn't
   * fail loudly: a request that's still genuinely in flight past this
   * window gets reclaimed and re-run concurrently with itself — the exact
   * duplicate this whole pattern exists to prevent, reintroduced by the
   * safety mechanism itself. Measure the slowest enforced endpoint's real
   * p99 before choosing a number; do not copy a value from a different
   * project's different endpoints.
   */
  staleAfterSeconds: number;
}
