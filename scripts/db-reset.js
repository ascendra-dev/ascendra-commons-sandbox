#!/usr/bin/env node
/**
 * A clean slate: drops everything in the sandbox database (schema `public`), migrates from scratch, then seeds.
 * Sandbox data is always regenerable, so there's no prompt.
 *
 *   npm run db:reset [-- --no-seed] [-- --days 90 --seed 42 --volume normal]   (seed options pass through)
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { connect, migrate } = require('./migrations');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const noSeed = args.includes('--no-seed');
const seedArgs = args.filter((a) => a !== '--no-seed');

(async () => {
  const client = await connect();
  try {
    const { rows } = await client.query('SELECT current_database() AS db');
    console.log(`Resetting database "${rows[0].db}" — dropping schema public …`);
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    await migrate(client);
  } finally {
    await client.end();
  }
  if (noSeed) return;
  const run = (cmd, cmdArgs) => {
    const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', env: process.env });
    if (r.status !== 0) process.exit(r.status ?? 1);
  };
  run('npx', ['nest', 'build']);
  run(process.execPath, ['dist/cli/seed.js', ...seedArgs]);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
