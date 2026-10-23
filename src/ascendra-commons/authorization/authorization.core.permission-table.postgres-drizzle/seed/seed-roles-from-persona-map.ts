import { sql } from 'drizzle-orm';
import { textArray } from '../persistence/sql-helpers';
import { syncActions } from './sync-actions';
import type { SqlExecutor } from '../persistence/sql-executor';

/**
 * Turn a Model 1 `personaActions` map into `commons_authz_role` + `commons_authz_role_permission`
 * rows, so switching a project from `static-map` to `permission-table` is
 * behaviour-preserving: each persona becomes a role granting exactly the actions
 * it did before.
 *
 * Assigning users to their persona-role (`commons_authz_user_role`) is a data migration
 * the consuming project owns — it has the users table. Typically:
 * `INSERT INTO commons_authz_user_role (user_id, tenant_id, role_id)
 *  SELECT id, tenant_id, persona FROM app_user`.
 *
 * Idempotent — safe to run repeatedly. Upserts roles and permissions; does not
 * delete anything (a persona removed from the map leaves its role in place).
 */
export async function seedRolesFromPersonaMap(
  db: SqlExecutor,
  personaActions: Record<string, string[] | '*'>,
): Promise<void> {
  const personas = Object.keys(personaActions);
  if (personas.length === 0) return;

  const allActions = [...new Set(Object.values(personaActions).flatMap((a) => (a === '*' ? [] : a)))];
  await syncActions(db, allActions);

  for (const persona of personas) {
    const grant = personaActions[persona];
    const grantsAll = grant === '*';
    await db.execute(sql`
      INSERT INTO commons_authz_role (id, description, grants_all)
      VALUES (${persona}, ${`Seeded from the ${persona} persona`}, ${grantsAll})
      ON CONFLICT (id) DO UPDATE SET grants_all = EXCLUDED.grants_all
    `);
    if (!grantsAll) {
      const actions = grant as string[];
      if (actions.length > 0) {
        await db.execute(sql`
          INSERT INTO commons_authz_role_permission (role_id, action)
          SELECT ${persona}, unnest(${textArray(actions)})
          ON CONFLICT (role_id, action) DO NOTHING
        `);
      }
    }
  }
}
