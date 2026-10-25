import { sql, type SQL } from 'drizzle-orm';

/**
 * A parameterised `text[]` literal — `ARRAY[$1, $2, ...]::text[]`. Drizzle's
 * `sql` template spreads a bare JS array into a row constructor `($1, $2)`,
 * which is not an array, so array columns go through this instead.
 */
export function textArray(values: readonly string[]): SQL {
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}
