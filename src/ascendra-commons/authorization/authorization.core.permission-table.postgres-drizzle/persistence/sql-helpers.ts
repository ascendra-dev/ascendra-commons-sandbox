import { sql, type SQL } from 'drizzle-orm';

/** A JS string[] as a real text[] — each element a bound parameter, never string-interpolated. */
export function textArray(values: readonly string[]): SQL {
  if (values.length === 0) return sql`'{}'::text[]`;
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

/** An assignment (`alias` = a `commons_authz_user_role` row) that still applies — not past its `expires_at`. */
export function activeAssignment(alias: string): SQL {
  const a = sql.raw(alias);
  return sql`(${a}.expires_at is null or ${a}.expires_at > now())`;
}

/**
 * Whether the granter of delegation `d` still holds `action` from a role, in the delegation's tenant (tenant-scoped or
 * global, active). A delegation lends only what its granter has — checked at every use, so revoking the granter's
 * role (or letting it expire) stops the delegation granting it.
 */
export function granterStillHolds(delegationAlias: string, action: SQL): SQL {
  const d = sql.raw(delegationAlias);
  return sql`exists (
    select 1 from commons_authz_user_role gur
    join commons_authz_role gr on gr.id = gur.role_id
    where gur.user_id = ${d}.granter_id
      and (gur.tenant_id = ${d}.tenant_id or gur.tenant_id is null)
      and ${activeAssignment('gur')}
      and (gr.grants_all or exists (
        select 1 from commons_authz_role_permission grp where grp.role_id = gr.id and grp.action = ${action}
      ))
  )`;
}

/** A timestamptz column at its own precision (microseconds) as ISO text — a keyset cursor's boundary; a JS Date keeps ms. */
export function isoMicros(column: string, as: string): SQL {
  return sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ${as}`);
}

/** A keyset cursor — JSON, base64url, so no part of it can hold a delimiter a caller chose. */
export function encodeCursor(parts: Record<string, string | null>): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url');
}

/**
 * Decodes a cursor this adapter issued, or `null` for anything else — the caller turns that into a 400 rather than
 * silently restarting at page one. `keys` are the string fields it must carry (`nullable` ones may be null).
 */
export function decodeCursor<K extends string>(
  cursor: string,
  keys: readonly K[],
  nullable: readonly K[] = [],
): Record<K, string | null> | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    for (const key of keys) {
      const value = parsed[key];
      if (value === null && nullable.includes(key)) continue;
      if (typeof value !== 'string' || value.length === 0) return null;
    }
    const ts = parsed.ts;
    if (typeof ts === 'string' && Number.isNaN(Date.parse(ts))) return null;
    return parsed as Record<K, string | null>;
  } catch {
    return null;
  }
}
