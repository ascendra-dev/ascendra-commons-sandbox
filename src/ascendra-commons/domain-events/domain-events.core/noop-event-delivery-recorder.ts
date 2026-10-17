import type { EventDeliveryAttempt, EventDeliveryRecorder } from './event-delivery-recorder.port';

/**
 * The default binding when no `recorderToken` is configured — every call
 * resolves immediately and does nothing. Keeps the emitter's own constructor
 * fallback (`new NoopEventDeliveryRecorder()`) working the same way
 * `notification`'s `NoopNotificationDeliveryRecorder` does.
 */
export class NoopEventDeliveryRecorder implements EventDeliveryRecorder {
  async recordDelivery(_attempt: EventDeliveryAttempt): Promise<void> {
    // intentionally inert
  }
}
