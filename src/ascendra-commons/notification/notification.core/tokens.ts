/**
 * Injection tokens. Symbols, not string literals — the same reasoning
 * `authorization`'s `AUTHORIZER` token uses, so a typo in a binding is a
 * compile error, not a silently unbound provider. Each exists because the
 * thing it points at is a TypeScript interface (no runtime representation) or
 * a value Nest can't auto-construct.
 */

/**
 * What `Notifier` and the three senders depend on — bound to whichever
 * `NotificationConfig` the app uses (the built-in `StaticNotificationConfig`,
 * or a consumer's own via `configToken`).
 */
export const NOTIFICATION_CONFIG = Symbol('NOTIFICATION_CONFIG');

/**
 * Resolves a `'user'` recipient's contact info. Defaults to
 * `NullUserContactResolver` in `NotificationModule.forRoot()`; a consumer
 * overrides it via `userContactResolverToken` once they have a real user table.
 */
export const USER_CONTACT_RESOLVER = Symbol('USER_CONTACT_RESOLVER');

/** A `Map<NotificationChannel, NotificationSender>` — assembled by a factory, not a class Nest constructs directly. */
export const NOTIFICATION_CHANNEL_SENDERS = Symbol('NOTIFICATION_CHANNEL_SENDERS');

/** What feature/listener code injects — `Notifier` is a class, but call sites depend on this token so the strategy can be swapped without touching them. */
export const NOTIFIER = Symbol('NOTIFIER');

/**
 * The `NotificationDeliveryRecorder` `Notifier` writes each send's per-channel
 * outcome through. `NotificationModule.forRoot()` binds this to
 * `NoopNotificationDeliveryRecorder` unless the consumer passes
 * `deliveryRecorderToken` (e.g. `POSTGRES_NOTIFICATION_DELIVERY_RECORDER`).
 */
export const NOTIFICATION_DELIVERY_RECORDER = Symbol('NOTIFICATION_DELIVERY_RECORDER');

/** The `NotificationSuppressionList` `Notifier` asks before each send — none unless `forRoot({ suppressionListToken })`. */
export const NOTIFICATION_SUPPRESSION_LIST = Symbol('NOTIFICATION_SUPPRESSION_LIST');

/** Where the `in_app` channel delivers — none unless `forRoot({ inboxToken })`. */
export const NOTIFICATION_INBOX = Symbol('NOTIFICATION_INBOX');

/** The `NotificationPreferences` Notifier asks for a user recipient — none unless `forRoot({ preferencesToken })`. */
export const NOTIFICATION_PREFERENCES = Symbol('NOTIFICATION_PREFERENCES');

/** The `NotificationDeduplicator` `notify({ dedupeKey })` claims through — none unless `forRoot({ deduplicatorToken })`. */
export const NOTIFICATION_DEDUPLICATOR = Symbol('NOTIFICATION_DEDUPLICATOR');

/** How long a dedupe key holds — `forRoot({ dedupeWindowMs })`, default 24 h. */
export const NOTIFICATION_DEDUPE_WINDOW_MS = Symbol('NOTIFICATION_DEDUPE_WINDOW_MS');

/** The `NotificationRecipientHasher` — or `null` when the app gives no `recipientHashKey` (address search off). */
export const NOTIFICATION_RECIPIENT_HASHER = Symbol('NOTIFICATION_RECIPIENT_HASHER');

/** The app's declared `NotificationTypeDefinition[]` — `forRoot({ types })`; empty when it declares none. */
export const NOTIFICATION_TYPES = Symbol('NOTIFICATION_TYPES');
