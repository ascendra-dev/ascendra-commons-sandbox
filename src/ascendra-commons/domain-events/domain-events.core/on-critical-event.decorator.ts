import { OnEvent } from '@nestjs/event-emitter';

// @nestjs/event-emitter doesn't re-export OnEventOptions from its public entry
// point — derived structurally from OnEvent's own signature instead of
// reaching into the package's internal file paths, which could break across
// a version bump with no compile error to catch it.
type OnEventOptions = NonNullable<Parameters<typeof OnEvent>[1]>;

/**
 * Use this instead of the raw @OnEvent() for any listener whose failure must
 * propagate back through emitCritical() — e.g. an audit listener.
 *
 * @OnEvent() defaults to { suppressErrors: true }: NestJS's own
 * EventSubscribersLoader catches whatever a listener throws, logs it, and
 * does not re-throw — regardless of whether the event was raised via emit()
 * or emitCritical(). That default silently defeats emitCritical()'s entire
 * contract for any listener that doesn't explicitly override it, and nothing
 * signals the mismatch — the caller's await just resolves normally while the
 * listener's failure gets logged and dropped. This decorator makes the
 * correct setting the path of least resistance instead of something every
 * critical listener's author has to remember on their own.
 */
export function OnCriticalEvent(event: string, options?: Omit<OnEventOptions, 'suppressErrors'>) {
  return OnEvent(event, { ...options, suppressErrors: false });
}
