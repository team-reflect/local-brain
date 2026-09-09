// Real-SQLite bridge for core integration tests. Database creation and migration
// replay live in @local-brain/db/testing; this module mirrors native IPC commands.

import { setBridge } from '@local-brain/core'
export { freshDatabase } from '@local-brain/db/testing'

/** Mirror the Rust bridge's json_to_sql: booleans -> 0/1, arrays/objects -> JSON text. */
function toSqlParam(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object') return JSON.stringify(value)
  return value
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
      if (command === 'active_database_identity' || command === 'embed_database_identity') {
        return Promise.resolve({ databasePath: '/test/brain.sqlite', generation: 1 })
      }
      if (command === 'embed_delete') {
        // Mirror the Rust `embed_delete`: drop chunk_embeddings rows (and their
        // chunk_vectors, which this harness strips) for the given chunk ids.
        let deleted = 0
        for (const chunkId of args.chunkIds) {
          deleted += Number(database.prepare('DELETE FROM chunk_embeddings WHERE chunk_id = ?').run(chunkId).changes)
        }
        return Promise.resolve(deleted)
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    },
  })
}
