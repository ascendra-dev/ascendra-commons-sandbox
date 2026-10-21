# `rate-limiting.core.throttler` — the `@nestjs/throttler` integration

The one concrete throttling implementation this pattern uses — no other
library is in play, so unlike most modules in this library there's no real
Model 1/Model 2 split for "which throttling engine"; the family-shaped name
(`.core.throttler`) instead marks *how* this piece plugs into `.core`'s
generic recorder port.

## `RecordingThrottlerGuard`

A drop-in subclass of `@nestjs/throttler`'s own `ThrottlerGuard` — same
`@Throttle()` declarations, same `429`, same everything — with one addition:
every rejection is recorded through the optional `RATE_LIMIT_EVENT_RECORDER`
token before the exception is thrown.

**Why a subclass, not a plain `ExceptionFilter` catching `ThrottlerException`:**
`throwThrottlingException(context, throttlerLimitDetail)` is the one method
`@nestjs/throttler` itself designed to be overridden (it's `protected`, not
`private`), and it's the only place with access to `ThrottlerLimitDetail` —
the tracker (identifier), limit, and ttl that were actually exceeded. A
filter catching the exception after the fact would only see the response,
not that detail.

Recording is best-effort and guarded exactly like every other recorder in
this library: a failure to log a rejection never changes whether the request
is actually throttled — `throwThrottlingException()` still runs, and the
`429` still fires, even if recording itself throws.

## Wiring

Register in place of the plain `ThrottlerGuard` — nothing else about how the
project uses `@nestjs/throttler` changes; `@Throttle()` declarations at each
endpoint are untouched:

```typescript
@Module({
  imports: [
    ThrottlerModule.forRoot({ throttlers: [{ limit: 20, ttl: 60_000 }] }),   // unchanged, project-owned
    RateLimitingThrottlerModule.forRoot({
      recorderToken: POSTGRES_RATE_LIMIT_EVENT_RECORDER,   // optional — omit for no rejection log at all
      imports: [PostgresRateLimitEventRecorderModule.forRoot({ ... })],
    }),
  ],
  providers: [{ provide: APP_GUARD, useExisting: RecordingThrottlerGuard }],
})
export class AppModule {}
```

## Depends on

`rate-limiting.core`, `@nestjs/common`, `@nestjs/core` (`Reflector`), `@nestjs/throttler`.
