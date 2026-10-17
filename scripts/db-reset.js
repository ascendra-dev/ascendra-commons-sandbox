#!/usr/bin/env node
/**
 * Drops everything in the sandbox database (schema `public`) and migrates from scratch — a clean slate. Sandbox data
 * is always regenerable, so there's no prompt. (The seed step joins this in phase 3.)
 */
const { connect, migrate } = require('./migrations');

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
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
