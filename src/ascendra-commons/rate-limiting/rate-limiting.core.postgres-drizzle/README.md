# `rate-limiting.core.postgres-drizzle` — the Postgres/Drizzle adapter

One table, one write path, one read path.

| Sub-folder | Implements | Bound under | Wired via |
|---|---|---|---|
| `recorder/` | `RateLimitEventRecorder` — counts in memory, upserts one row per rejection window every `flushIntervalMs` | `RATE_LIMIT_EVENT_RECORDER` (core token) | `RateLimitingThrottlerModule.forRoot({ recorderToken })` |
| `observability/` | `RateLimitObservabilityPort` — `listRejections()` / `rejectionCatalog()` / `topIdentifiers()`, read-only | `RATE_LIMIT_OBSERVABILITY_PORT` (core token) | `PostgresRateLimitObservabilityModule.forRoot(...)` |
| `retention/` | `PostgresRateLimitRetentionService.pruneRejections(before)` — batched delete, for the project's own scheduler | (class — inject it) | `PostgresRateLimitRetentionModule.forRoot(...)` |
| `persistence/rate-limit-rejection.schema.ts` | the table's current shape — change it with the `INSERT` | | |
| `migrations/` | the DDL, numbered — **never edited once released**; a schema change is the next file | | |

No family package — both core ports are stack-agnostic and live in
`rate-limiting.core`. A project on another stack implements those and ignores
this folder.

## Wiring

Tables: apply `migrations/` (`ascendra-commons.js` delivers them into your migrations) with your own migration tool — never re-export the schema tables to `drizzle-kit` too, or it generates them a second time (MODULE-STANDARD dimension 7).

```typescript
RateLimitingThrottlerModule.forRoot({
  recorderToken: POSTGRES_RATE_LIMIT_EVENT_RECORDER,
  imports: [
    PostgresRateLimitEventRecorderModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
  ],
}),
// for a security/ops read screen (independent — import if wanted):
PostgresRateLimitObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
```

Requires **Postgres 15+** (`0002` adds a `UNIQUE NULLS NOT DISTINCT`
constraint — rejections without a correlation id must still merge into one
row).

## The recorder buffers

A rejection is counted in memory, never written on the `429` path. Every
`flushIntervalMs` (default 10s) the buffer is upserted as one row per route,
identifier, limit, ttl, minute (`window_start`) and correlation id —
`rejection_count`, `first_rejected_at`, `last_rejected_at`. Several instances
upsert into the same rows.

```typescript
PostgresRateLimitEventRecorderModule.forRoot({
  sqlExecutorToken: DATABASE_CONNECTION,
  application: 'ascendra-pay',
  flushIntervalMs: 10_000,   // optional — at most this much is lost if the process dies
  maxBufferedKeys: 10_000,   // optional — past this, new sources count under '(overflow)' per route
  imports: [DatabaseModule],
}),
```

- **Shutdown:** the buffer is flushed once more in `onModuleDestroy` — call
  `app.enableShutdownHooks()` so that runs on `SIGTERM`.
- **Failure:** a failed flush is logged and its counts dropped, never retried.
- **Overflow:** a distributed flood from more than `maxBufferedKeys` sources
  between flushes keeps exact per-route totals; only the per-source split of
  the excess is lost (counted as identifier `(overflow)`).

## `application`

Stamped on every row, filtered on by every read.

## Retention

Never pruned on its own — the consumer owns retention (MODULE-STANDARD
dimension 7). `PostgresRateLimitRetentionModule` provides
`PostgresRateLimitRetentionService`; call `pruneRejections(before)` from the
project's scheduler. It deletes this `application`'s windows that started before
the cutoff, 5,000 rows per statement so a backlog never holds one long lock on a
table the throttler writes to, and returns the count.

```typescript
PostgresRateLimitRetentionModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),

// e.g. inside a background-jobs ScheduledJob, run daily:
await retention.pruneRejections(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
```

## Depends on

`rate-limiting.core`, `@nestjs/common`, `drizzle-orm` (`drizzle-orm/pg-core`).
