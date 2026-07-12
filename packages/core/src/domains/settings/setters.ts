import { db } from '../../db/client'
import { execute } from '../../db/commands'
import type { DatabaseIdentity } from '../../db/identity'
import { nowIso } from '../../db/time'

/**
 * Upsert a settings key. The value is JSON-encoded into `value_json`. SQLite
 * `ON CONFLICT` keeps this a single atomic write. Pass `identity` when the
 * setting belongs to a longer asynchronous workflow; the native boundary then
 * rejects the write if another brain became active meanwhile.
 */
export async function setSetting(
  key: string,
  value: unknown,
  identity?: DatabaseIdentity,
): Promise<void> {
  const valueJson = JSON.stringify(value ?? null)
  await execute(
    db
      .insertInto('settings')
      .values({ key, valueJson, updatedAt: nowIso() })
      .onConflict((oc) => oc.column('key').doUpdateSet({ valueJson, updatedAt: nowIso() })),
    identity,
  )
}

export async function deleteSetting(key: string): Promise<number> {
  return execute(db.deleteFrom('settings').where('key', '=', key))
}
