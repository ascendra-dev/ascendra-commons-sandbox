import type { Rng } from './rng';

/**
 * Generates rate-limit rejections the only way the module records them: real requests to throttled endpoints
 * (src/demo), turned away by `@nestjs/throttler` and reported by RecordingThrottlerGuard. Each caller's address goes
 * in `X-Forwarded-For` — the app trusts one proxy (src/configure-app.ts), exactly as it would behind a load balancer.
 *
 * Recent only: the recorder stamps each rejection with the real clock, and nothing lets a caller set a past time, so
 * everything lands in the minute or two the run takes. `npm run simulate` keeps adding bursts as time passes.
 *
 * Addresses come from the documentation / benchmarking ranges (RFC 5737, RFC 2544, RFC 6598) — never a real host.
 */

/** One enumerator walking payment-link tokens. */
const ENUMERATOR = '203.0.113.7';
/** One brute-forcing a sign-in. */
const BRUTE_FORCER = '192.0.2.44';
/** A partner integration — well-behaved, correlation ids on every call, just polling too fast. */
const PARTNER = '100.64.0.12';
/** A normal visitor who stays under every limit — no rejections. */
const VISITOR = '198.51.100.23';
/** A partner's nightly sync job — one correlation id for the whole job, across routes. */
const SYNC_JOB = '100.64.0.40';

export interface RateLimitTotals {
  requests: number;
  rejected: number;
}

export class RateLimitHistory {
  private readonly totals: RateLimitTotals = { requests: 0, rejected: 0 };

  constructor(
    private readonly baseUrl: string,
    private readonly rng: Rng,
  ) {}

  /** One request from `ip` — true when it was rate-limited (429). */
  async hit(method: 'GET' | 'POST', path: string, ip: string, headers: Record<string, string> = {}): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers: { 'X-Forwarded-For': ip, ...headers } });
    await res.arrayBuffer();
    this.totals.requests += 1;
    if (res.status === 429) this.totals.rejected += 1;
    return res.status === 429;
  }

  async run(): Promise<RateLimitTotals> {
    await this.visitor();
    await this.enumeration(ENUMERATOR, 300);
    await this.bruteForce(BRUTE_FORCER, 40);
    await this.partnerPolling();
    await this.syncJob(SYNC_JOB);
    await this.syncJob('100.64.0.41');
    // Last, and wider than the sandbox recorder's buffer (100 sources): the excess lands in an `(overflow)` row.
    await this.distributedEnumeration(150, 24);
    return this.totals;
  }

  /** A visitor opens a payment link, then pays from a fresh one — well under the 20/min limit. */
  async visitor() {
    for (let i = 0; i < 3; i++) await this.hit('GET', `/demo/pay/${this.token()}`, VISITOR);
  }

  /** One address tries `count` random payment-link tokens as fast as it can — everything past 20 a minute is a 429. */
  async enumeration(ip: string, count: number) {
    for (let i = 0; i < count; i++) await this.hit('GET', `/demo/pay/${this.token()}`, ip);
  }

  /** One address keeps guessing a password — the 5/min sign-in limit turns away the rest. */
  async bruteForce(ip: string, attempts: number) {
    for (let i = 0; i < attempts; i++) await this.hit('POST', '/demo/login', ip);
  }

  /**
   * A partner polls quotes 14 times in a burst, each call with its own correlation id — the last 4 are turned away,
   * each under its own id, so each one is findable by trace. Its client retries one rejected call with the same id:
   * that window counts 2.
   */
  async partnerPolling() {
    let lastRejected: string | undefined;
    for (let i = 0; i < 14; i++) {
      const correlationId = this.rng.uuid();
      if (await this.hit('GET', '/demo/quotes', PARTNER, { 'X-Correlation-Id': correlationId })) lastRejected = correlationId;
    }
    if (lastRejected) await this.hit('GET', '/demo/quotes', PARTNER, { 'X-Correlation-Id': lastRejected });
  }

  /**
   * A partner's sync job: one correlation id for the whole job (as audit-logging traces a job), refreshing quotes and
   * re-checking its payment links in a tight loop — both limits turn part of it away, so its trace has a window on
   * each route. Returns the job's correlation id.
   */
  async syncJob(ip: string): Promise<string> {
    const correlationId = this.rng.uuid();
    const headers = { 'X-Correlation-Id': correlationId };
    for (let i = 0; i < 16; i++) await this.hit('GET', '/demo/quotes', ip, headers);
    for (let i = 0; i < 26; i++) await this.hit('GET', `/demo/pay/${this.token()}`, ip, headers);
    return correlationId;
  }

  /** `sources` addresses each try `perSource` tokens — a botnet spreading an enumeration thin. Run concurrently. */
  async distributedEnumeration(sources: number, perSource: number) {
    const ips = Array.from({ length: sources }, (_, i) => `198.18.${Math.floor(i / 250)}.${(i % 250) + 1}`);
    await Promise.all(ips.map(async (ip) => {
      for (let i = 0; i < perSource; i++) await this.hit('GET', `/demo/pay/${this.token()}`, ip);
    }));
  }

  /** A random payment-link-shaped token — never a real one, so every link "doesn't exist". */
  private token(): string {
    return this.rng.uuid().replace(/-/g, '');
  }
}
