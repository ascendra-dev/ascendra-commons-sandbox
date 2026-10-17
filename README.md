# ascendra-commons-sandbox

A NestJS host app that runs `ascendra-commons` modules for real — vendored exactly as a product would vendor them —
so `ascendra-commons-ui` is built and reviewed against real APIs and real data instead of mocks.

The plan, decisions and phase status: [docs/PLAN.md](docs/PLAN.md).

## Quickstart

Needs Node 20.6+ (for `--env-file`) and Docker.

```sh
cp .env.example .env
npm install
npm run db:up        # Postgres 16 in docker, on :5433
npm run db:migrate   # the vendored packages' migrations
npm run start:dev    # http://localhost:3010 — GET /health
```

## Commands

| Command | Does |
|---|---|
| `npm run db:up` / `db:down` | Start / stop the sandbox's Postgres container. |
| `npm run db:migrate` | Apply migrations not yet applied: each vendored package's `*.migration.sql` (manifest order), then `src/db/migrations/*.sql`. |
| `npm run db:reset` | Drop everything and migrate from scratch. |
| `npm run commons:update -- --yes [--from ../ascendra-commons]` | Re-vendor the packages in `commons.manifest.json` into `src/ascendra-commons/` — from GitHub, or a local checkout. Records the source commit in `src/ascendra-commons/VENDORED.json`. |
| `npm run start:dev` / `build` / `start` | Run in watch mode / build / run the build. |
| `npm run typecheck` | Typecheck, vendored code included. |

`src/ascendra-commons/` is vendored — never edit it here. Change the module in `ascendra-commons`, then re-sync.
If a sync changes a migration that was already applied, `db:migrate` refuses and asks for `db:reset`.
