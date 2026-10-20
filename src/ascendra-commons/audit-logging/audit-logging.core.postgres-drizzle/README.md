# `audit-logging.core.postgres-drizzle` — the Postgres/Drizzle stack adapter

Two library-owned statements over `commons_audit_event`:

| Sub-folder | Implements | Bound under | Wired via |
|---|---|---|---|
| `persistence/` | `AuditEventRepository` — one `INSERT`, `application` stamped | `POSTGRES_AUDIT_EVENT_REPOSITORY` | `AuditLoggingModule.forRoot({ auditEventRepositoryToken })` |
| `observability/` | `AuditEventReader` — one dynamic `SELECT`, keyset-paginated, `application`-scoped | `AUDIT_EVENT_READER` (core token) | `PostgresAuditObservabilityModule.forRoot(...)` |
| `persistence/audit-event.schema.ts` | the table's current shape — change it with the `INSERT` | | |
| `migrations/` | the DDL, numbered — **never edited once released**; a schema change is the next file | | |

There is no family package — both ports and all DTOs are stack-agnostic and
live in `audit-logging.core`; the keyset-cursor helper is there too. A project on
another stack implements those two core ports and ignores this folder.

## Wiring

Tables: apply `migrations/` (`ascendra-commons.js` delivers them into your migrations) with your own migration tool — never re-export the schema tables to `drizzle-kit` too, or it generates them a second time (MODULE-STANDARD dimension 7). **Requires PostgreSQL 15+.**

```typescript
DomainEventsModule.forRoot({ emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER, imports: [InProcessDomainEventEmitterModule.forRoot()] }),
AuditLoggingModule.forRoot({
  auditEventRepositoryToken: POSTGRES_AUDIT_EVENT_REPOSITORY,
  imports: [PostgresAuditPersistenceModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
}),
// for a compliance/ops read screen (independent — import either or both):
PostgresAuditObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
```

The repository inserts through exactly the executor `sqlExecutorToken` resolves to. A plain pool (as above)
commits each audit record on its own, outside the caller's transaction; to make a change and its audit record
atomic, give it an executor bound to that transaction — see the module README, "Consuming this module".

## `application`

Stamped on insert (`PostgresAuditPersistenceModule.forRoot({ application })`, one
string) and scoped on every read (`application in (…)`): the observability module's
`application` is one name — an app's own screen sees only its own rows — or a list,
for a backend that serves more than one application. `AuditQuery.application`
(`GET /audit/events?application=`) narrows within that scope, never beyond it.

## Indexes

`0001`: `(entity_type, entity_id)` for an entity's history, `(tenant_id, occurred_at)`
for a tenant's feed. `0002` adds what the screens' other reads need:
`(application, occurred_at desc, id desc)` — with one application per table it
doesn't *filter* anything, but it gives the list its order, so a page reads its 51
rows instead of sorting the whole table, and the overview's time windows become
range reads; `(correlation_id)` for a trace; `(application, actor, occurred_at desc)`
for an actor's activity. Counting every row (the retention figures) still reads the
whole table. On a large table, build `0002`'s indexes `CONCURRENTLY` first — see the
migration.

## Retention

None — audit records are kept indefinitely, an explicit decision given the
financial nature of the data. If a jurisdiction ever requires a purge window,
that's the consumer's `DELETE`/`ScheduledJob`.

## Depends on

`audit-logging.core` (+ `domain-events` transitively), `@nestjs/common`,
`drizzle-orm` (`drizzle-orm/pg-core`).
