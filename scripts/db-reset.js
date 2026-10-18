#!/usr/bin/env node
/**
 * A clean slate: drops the sandbox's tables and drizzle-kit's migration journal, migrates from scratch with
 * drizzle-kit (what `db:migrate` runs), then seeds. Sandbox data is always regenerable, so there's no prompt.
 *
 *   npm run db:reset [-- --no-seed] [-- --days 90 --seed 42 --volume normal]   (seed options pass through)
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const noSeed = args.includes('--no-seed');
const seedArgs = args.filter((a) => a !== '--no-seed');

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set — copy .env.example to .env.');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT current_database() AS db');
    console.log(`Resetting database "${rows[0].db}" — dropping schema public and drizzle-kit's journal …`);
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  } finally {
    await client.end();
  }
  run('npx', ['drizzle-kit', 'migrate']);
  if (noSeed) return;
  run('npx', ['nest', 'build']);
  run(process.execPath, ['dist/cli/seed.js', ...seedArgs]);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
