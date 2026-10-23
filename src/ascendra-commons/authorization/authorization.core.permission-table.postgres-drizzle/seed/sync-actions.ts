import { sql } from 'drizzle-orm';
import type { ActionScope } from '../../authorization.core.permission-table';
import { textArray } from '../persistence/sql-helpers';
import type { SqlExecutor } from '../persistence/sql-executor';

/** An action key, or one with its scope — `platform` for an action that reads or changes every tenant's data. */
export type ActionCatalogEntry = string | { name: string; scope: ActionScope };

/**
 * Upsert the app's action keys into `commons_authz_action`. Run at startup or from a
 * migration, with your project's action catalog.
 *
 * A new key gets a row with `description = NULL`. A description typed into the admin UI survives every redeploy. An
 * entry given **with a scope** sets it on every sync — scope is the code's decision, like the name; a bare key never
 * touches an existing row's scope (new ones are `tenant`). Keys removed from the code catalog are **not** deleted
 * here (the `commons_authz_role_permission` FK would block it anyway); removing an action is a deliberate migration.
 */
export async function syncActions(db: SqlExecutor, catalog: readonly ActionCatalogEntry[]): Promise<void> {
  const bare = [...new Set(catalog.filter((e): e is string => typeof e === 'string'))].filter((k) => k.length > 0);
  const scoped = new Map<string, ActionScope>();
  for (const e of catalog) if (typeof e !== 'string' && e.name.length > 0) scoped.set(e.name, e.scope);

  if (bare.length > 0) {
    await db.execute(sql`
      INSERT INTO commons_authz_action (name)
      SELECT unnest(${textArray(bare)})
      ON CONFLICT (name) DO NOTHING
    `);
  }
  if (scoped.size > 0) {
    await db.execute(sql`
      INSERT INTO commons_authz_action (name, scope)
      SELECT * FROM unnest(${textArray([...scoped.keys()])}, ${textArray([...scoped.values()])})
      ON CONFLICT (name) DO UPDATE SET scope = EXCLUDED.scope
    `);
  }
}
