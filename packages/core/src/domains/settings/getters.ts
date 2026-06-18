import { db } from '../../db/client'

/**
 * The `settings` table is a typed key/value store: `value_json` holds a JSON
 * document per key. Product policy (model boundary, storage path, backup state)
 * reads/writes through these helpers and the typed accessors in `model.ts`.
 * Provider *secrets* never live here — those belong in the OS keychain (Plan 08).
 */

export async function getSettingRaw(key: string): Promise<unknown> {
  const row = await db
    .selectFrom('settings')
    .select('valueJson')
    .where('key', '=', key)
    .executeTakeFirst()
  if (!row) return undefined
  try {
    return JSON.parse(row.valueJson) as unknown
  } catch {
    return undefined
  }
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const value = await getSettingRaw(key)
  return value === undefined ? fallback : (value as T)
}

export interface SettingEntry {
  key: string
  value: unknown
}

export async function listSettings(): Promise<SettingEntry[]> {
  const rows = await db.selectFrom('settings').select(['key', 'valueJson']).orderBy('key', 'asc').execute()
  return rows.map((row) => {
    let value: unknown
    try {
      value = JSON.parse(row.valueJson)
    } catch {
      value = null
    }
    return { key: row.key, value }
  })
}
