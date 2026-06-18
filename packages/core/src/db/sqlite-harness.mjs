// Shared real-SQLite test harness for the core domain round-trip tests.
//
// This file is .mjs on purpose: it imports Node's built-in `node:sqlite`, which
// has no TypeScript types yet, so it must stay out of the typechecked `src`
// surface. It installs an IPC bridge backed by a real in-memory SQLite database
// (the actual crates/brain-schema migrations), mirroring the Rust bridge's
// JSON->SQLite conversion, so the real getters/setters run end to end.

import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setBridge } from '@local-brain/core'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', '..', '..', '..', 'crates', 'brain-schema', 'migrations')

/** Mirror the Rust bridge's json_to_sql: booleans -> 0/1, arrays/objects -> JSON text. */
function toSqlParam(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/**
 * Strip `CREATE VIRTUAL TABLE … USING vec0(…)` before replay: the sqlite-vec
 * extension is registered by the Rust runtime but absent from Node's built-in
 * SQLite. Real vector search is exercised by the Rust tests; these JS round-trip
 * tests cover the lexical/CRUD path and stub the embedding bridge directly.
 */
function stripVec0(sql) {
  return sql.replace(/CREATE\s+VIRTUAL\s+TABLE[^;]*USING\s+vec0[^;]*;/gi, '')
}

export function freshDatabase() {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON;')
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    database.exec(stripVec0(readFileSync(join(migrationsDir, file), 'utf8')))
  }
  return database
}

/** An IPC bridge backed by a real SQLite database, like the Rust bridge. */
export function installSqliteBridge(database) {
  setBridge({
    invoke(command, args) {
      if (command === 'db_query') {
        const rows = database.prepare(args.sql).all(...args.params.map(toSqlParam))
        return Promise.resolve(rows)
      }
      if (command === 'db_execute') {
        const info = database.prepare(args.sql).run(...args.params.map(toSqlParam))
        return Promise.resolve(Number(info.changes))
      }
      if (command === 'db_batch') {
        database.exec('BEGIN')
        try {
          const affected = args.statements.map((statement) =>
            Number(database.prepare(statement.sql).run(...statement.params.map(toSqlParam)).changes),
          )
          database.exec('COMMIT')
          return Promise.resolve(affected)
        } catch (error) {
          database.exec('ROLLBACK')
          return Promise.reject(error)
        }
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    },
  })
}
