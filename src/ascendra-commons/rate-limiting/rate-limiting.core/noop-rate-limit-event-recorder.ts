import type { RateLimitEventRecorder, RateLimitRejection } from './rate-limit-event-recorder.port';

/** The default binding when no `recorderToken` is configured — every call resolves immediately and does nothing. */
export class NoopRateLimitEventRecorder implements RateLimitEventRecorder {
  async recordRejection(_rejection: RateLimitRejection): Promise<void> {
    // intentionally inert
  }
}
