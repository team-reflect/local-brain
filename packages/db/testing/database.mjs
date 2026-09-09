import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'

const migrationsDir = new URL('../../../crates/brain-schema/migrations/', import.meta.url)

/**
 * Replay the durable migrations into an in-memory database for tests and codegen.
 * The caller owns the connection and must close it when finished. Node lacks
 * sqlite-vec, so omit vec0 tables; Rust tests cover the real vector extension.
 */
export function freshDatabase() {
  const database = new DatabaseSync(':memory:')
  try {
    database.exec('PRAGMA foreign_keys = ON;')
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()
    for (const file of files) {
      const sql = readFileSync(new URL(file, migrationsDir), 'utf8')
      database.exec(sql.replace(/CREATE\s+VIRTUAL\s+TABLE[^;]*USING\s+vec0[^;]*;/gi, ''))
    }
    return database
  } catch (error) {
    database.close()
    throw error
  }
}
