import { Inject, Injectable } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { OnEvent, type OnEventMetadata } from '@nestjs/event-emitter';
import type { EventListenerCatalogEntry, EventListenerCatalogPort } from '../domain-events.core';

// Calling OnEvent(...) returns the actual per-call decorator function — and
// THAT function carries a public, runtime `.KEY` static (the metadata key
// every `@OnEvent()`/`@OnCriticalEvent()` call writes under — see the class
// doc comment), not the exported `OnEvent` reference itself. Calling it here
// with a throwaway event name is side-effect-free (it just builds and returns
// that function; nothing happens until the result is actually applied to a
// class member as `@OnEvent(...)`, which this never does) and reads the real
// runtime value instead of hand-duplicating the string literal, which would
// silently drift if a future version ever changed it.
const EVENT_LISTENER_METADATA_KEY = (OnEvent('__domain_event_listener_catalog_probe__') as unknown as { KEY: string })
  .KEY;

/**
 * Discovers every `@OnEvent()` / `@OnCriticalEvent()` binding in the running
 * application — "what listens to what," read straight from the same decorator
 * metadata `@nestjs/event-emitter`'s own `EventSubscribersLoader` uses to wire
 * listeners up to `EventEmitter2` in the first place.
 *
 * NOT via `EventEmitter2.listeners(eventName)`: by the time NestJS registers a
 * listener there, it has already wrapped it in an anonymous closure
 * (`EventSubscribersLoader.subscribeToEventIfListener()`) — every registered
 * function has no name, no owning class, nothing to print. This service reads
 * the metadata *before* that wrapping happens instead, straight off each
 * provider/controller's own prototype, where the class name and method name
 * are still attached.
 *
 * `OnEvent.KEY` (not the internal `EventsMetadataAccessor` / `EVENT_LISTENER_METADATA`
 * constant, neither of which `@nestjs/event-emitter` exports from its public
 * entry point) is the same "reach into a public static property, not a
 * private file path" approach `on-critical-event.decorator.ts` already uses
 * for `OnEventOptions` — a version bump can't silently break this the way
 * reaching into `dist/constants.js` could. `@OnCriticalEvent()` writes to this
 * exact same metadata key (it returns `OnEvent(...)` directly, only forcing
 * `suppressErrors: false`), so one read here sees both.
 *
 * Recomputes on every `list()` call — no caching, no bootstrap lifecycle hook.
 * The scan is O(providers × their methods), once, and this is an admin-screen
 * read, not a hot path.
 */
@Injectable()
export class DomainEventListenerCatalog implements EventListenerCatalogPort {
  constructor(
    // Explicit @Inject() on all three — bare type-based constructor injection
    // depends on TypeScript's design:paramtypes reflection metadata actually
    // being emitted and read at runtime, which esbuild-based transpilation
    // (vitest, and any consumer building without tsc) does not reliably
    // support. Same reasoning as this package's InProcessDomainEventEmitter's
    // own @Inject(EventEmitter2).
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly metadataScanner: MetadataScanner,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async list(): Promise<EventListenerCatalogEntry[]> {
    const entries: EventListenerCatalogEntry[] = [];

    const wrappers = [...this.discovery.getProviders(), ...this.discovery.getControllers()];
    for (const wrapper of wrappers) {
      // Mirrors EventSubscribersLoader.loadEventListeners()'s own filter — a
      // provider with no static instance (most commonly request/transient
      // scoped, or not yet resolved) has no prototype worth scanning here.
      if (!wrapper.instance || wrapper.isAlias) continue;

      const instance = wrapper.instance as Record<string, unknown>;
      const prototype = Object.getPrototypeOf(instance) as object | null;
      if (!prototype) continue;

      const listenerClass = (instance as { constructor?: { name?: string } }).constructor?.name || '(anonymous)';

      this.metadataScanner.scanFromPrototype(instance, prototype, (methodKey) => {
        const metadataList = this.reflector.get<OnEventMetadata[] | undefined>(
          EVENT_LISTENER_METADATA_KEY,
          instance[methodKey] as Function,
        );
        if (!metadataList) return;

        for (const { event, options } of metadataList) {
          const critical = options?.suppressErrors === false;
          const eventNames = Array.isArray(event) ? event : [event];
          for (const eventName of eventNames) {
            entries.push({ eventName: String(eventName), listenerClass, listenerMethod: methodKey, critical });
          }
        }
      });
    }

    return entries;
  }
}
