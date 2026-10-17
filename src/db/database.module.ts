import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/** The Drizzle database — what the vendored Postgres adapters take as their `sqlExecutorToken`. */
export const DATABASE_CONNECTION = Symbol('DATABASE_CONNECTION');
const DATABASE_POOL = Symbol('DATABASE_POOL');

export type Database = NodePgDatabase;

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) throw new Error('DATABASE_URL is not set — copy .env.example to .env.');
        const pool = new Pool({ connectionString });
        // An idle connection the database drops (a restart, `db:down`) is emitted as an 'error' on the pool — unhandled,
        // it kills the process. Log it instead: the pool discards that connection and opens a new one on the next query.
        pool.on('error', (err) => new Logger('Database').warn(`Idle connection lost: ${err.message}`));
        return pool;
      },
    },
    { provide: DATABASE_CONNECTION, useFactory: (pool: Pool) => drizzle(pool), inject: [DATABASE_POOL] },
  ],
  exports: [DATABASE_CONNECTION],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
