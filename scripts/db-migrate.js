#!/usr/bin/env node
/** Applies any migration not yet applied — see migrations.js. */
const { connect, migrate } = require('./migrations');

(async () => {
  const client = await connect();
  try {
    await migrate(client);
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
