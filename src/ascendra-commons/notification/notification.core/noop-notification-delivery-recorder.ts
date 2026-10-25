import { Injectable } from '@nestjs/common';
import type {
  DeliveryAttempt,
  DeliveryStatusUpdate,
  NotificationDeliveryRecorder,
} from './notification-delivery-recorder.port';

/**
 * The default `NotificationDeliveryRecorder` — records nothing. Bound by
 * `NotificationModule.forRoot()` whenever no `deliveryRecorderToken` is given,
 * so `Notifier` always has a recorder to call and the delivery log stays
 * strictly opt-in.
 */
@Injectable()
export class NoopNotificationDeliveryRecorder implements NotificationDeliveryRecorder {
  async recordAttempts(_attempts: DeliveryAttempt[]): Promise<void> {
    // intentionally empty
  }

  async updateDeliveryStatus(_update: DeliveryStatusUpdate): Promise<void> {
    // intentionally empty
  }
}
