import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit — this project's migration tool (`npm run db:migrate`), as in any Ascendra app. ascendra-commons'
 * migrations are delivered into `out` by `node ascendra-commons.js` (registered via `generate --custom`); the
 * sandbox's own tables, if it ever has any, are defined in `schema` and generated with `drizzle-kit generate`.
 * Never point `schema` at src/ascendra-commons — those tables come from the delivered migrations.
 */
export default defineConfig({
  schema: './src/db/schema',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
