/**
 * Shared by db-migrate.js and db-reset.js — this project's own migration tool, the way any consumer has one. It applies
 * src/db/migrations/*.sql in name order, each once, in a transaction, recorded with a checksum. ascendra-commons'
 * migrations arrive in that folder too, delivered by `node ascendra-commons.js add` / `update` (timestamped names).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'src', 'db', 'migrations');

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(MIGRATIONS_DIR, f));
  return files.map((file) => {
    const sql = fs.readFileSync(file, 'utf8');
    return { name: path.relative(ROOT, file), sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
  });
}

async function connect() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set — copy .env.example to .env.');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

async function migrate(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS sandbox_migration (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map((await client.query('SELECT name, checksum FROM sandbox_migration')).rows.map((r) => [r.name, r.checksum]));

  let count = 0;
  for (const m of listMigrations()) {
    const previous = applied.get(m.name);
    if (previous === m.checksum) continue;
    if (previous) {
      throw new Error(`${m.name} changed since it was applied — migrations are never edited. Run db:reset to rebuild the database.`);
    }
    await client.query('BEGIN');
    try {
      await client.query(m.sql);
      await client.query('INSERT INTO sandbox_migration (name, checksum) VALUES ($1, $2)', [m.name, m.checksum]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`${m.name} failed: ${err.message}`);
    }
    console.log(`  ✓ ${m.name}`);
    count++;
  }
  console.log(count ? `Applied ${count} migration(s).` : 'Up to date — nothing to apply.');
}

module.exports = { connect, migrate };
