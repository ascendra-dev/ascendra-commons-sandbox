import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION, type Database } from '../db/database.module';

/** `GET /health` — the app is up and can reach its database. */
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  @Get()
  async health() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
    return { status: 'ok', database: 'ok' };
  }
}
