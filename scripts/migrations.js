/**
 * Shared by db-migrate.js and db-reset.js. Migrations, in order: each vendored package's *.migration.sql (manifest
 * order — ascendra-commons ships them as reference migrations for the consumer to apply), then this sandbox's own
 * src/db/migrations/*.sql (name order). Each is applied once, in a transaction, and recorded with a checksum.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'commons.manifest.json'), 'utf8'));

function findSqlFiles(dir, suffix) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(suffix))
    .map((e) => path.join(e.parentPath ?? e.path, e.name))
    .sort();
}

function listMigrations() {
  const vendored = manifest.packages.flatMap((pkg) =>
    findSqlFiles(path.join(ROOT, 'src', 'ascendra-commons', pkg), '.migration.sql'));
  const own = findSqlFiles(path.join(ROOT, 'src', 'db', 'migrations'), '.sql');
  return [...vendored, ...own].map((file) => {
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
      throw new Error(`${m.name} changed since it was applied (a newer sync?). Run db:reset to rebuild the database.`);
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
