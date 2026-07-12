import { createDb } from '@local-brain/db'
import { getBridge } from '../ipc/bridge'
import { expectedDatabaseArgs, type DatabaseIdentity } from './identity'

/**
 * The app-wide Kysely instance. Reads compile to `{ sql, params }` in TypeScript
 * and run through the Rust-owned SQLite connection via the `db_query` command.
 * Writes never execute through Kysely's driver — domain setters `.compile()`
 * their insert/update/delete and send the SQL to `db_execute`/`db_batch`, where
 * Rust owns the transaction (see `commands.ts` and the architecture rules in
 * docs/plans/02). The CamelCasePlugin maps camelCase identifiers to the
 * snake_case schema and back on result rows.
 */
export const db = createDb((sql, params) => getBridge().invoke('db_query', { sql, params }))

/** A read-only Kysely client whose every query is rejected after a brain switch. */
export function dbForDatabase(identity: DatabaseIdentity): ReturnType<typeof createDb> {
  return createDb((sql, params) =>
    getBridge().invoke('db_query', { sql, params, ...expectedDatabaseArgs(identity) }),
  )
}
