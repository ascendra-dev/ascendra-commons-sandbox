# `audit-logging.core.postgres-drizzle` — the Postgres/Drizzle stack adapter

Two library-owned statements over `commons_audit_event`:

| Sub-folder | Implements | Bound under | Wired via |
|---|---|---|---|
| `persistence/` | `AuditEventRepository` — one `INSERT`, `application` stamped | `POSTGRES_AUDIT_EVENT_REPOSITORY` | `AuditLoggingModule.forRoot({ auditEventRepositoryToken })` |
| `observability/` | `AuditEventReader` — one dynamic `SELECT`, keyset-paginated, `application`-scoped | `AUDIT_EVENT_READER` (core token) | `PostgresAuditObservabilityModule.forRoot(...)` |
| `persistence/audit-event.schema.ts` + `.migration.sql` | the reference table — **keep in sync** with the `INSERT` | | |

There is no family package — both ports and all DTOs are stack-agnostic and
live in `audit-logging.core`; the keyset-cursor helper is there too. A project on
another stack implements those two core ports and ignores this folder.

## Wiring

```typescript
export * from 'src/ascendra-commons/audit-logging/audit-logging.core.postgres-drizzle';   // for drizzle-kit
```

…or copy `persistence/audit-event.migration.sql`. **Requires PostgreSQL 15+.**

```typescript
DomainEventsModule.forRoot({ emitterToken: IN_PROCESS_DOMAIN_EVENT_EMITTER, imports: [InProcessDomainEventEmitterModule.forRoot()] }),
AuditLoggingModule.forRoot({
  auditEventRepositoryToken: POSTGRES_AUDIT_EVENT_REPOSITORY,
  imports: [PostgresAuditPersistenceModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] })],
}),
// for a compliance/ops read screen (independent — import either or both):
PostgresAuditObservabilityModule.forRoot({ sqlExecutorToken: DATABASE_CONNECTION, application: 'ascendra-pay', imports: [DatabaseModule] }),
```

## `application`

Stamped on insert and filtered on every read (`application = $1`), so an app's
own screen sees only its own rows. Constant within one app's database; the
column keeps the table correct if audit history is ever consolidated for
cross-product compliance reporting (see the module README, "the one to watch").

## Retention

None — audit records are kept indefinitely, an explicit decision given the
financial nature of the data. If a jurisdiction ever requires a purge window,
that's the consumer's `DELETE`/`ScheduledJob`.

## Depends on

`audit-logging.core` (+ `domain-events` transitively), `@nestjs/common`,
`drizzle-orm` (`drizzle-orm/pg-core`).
