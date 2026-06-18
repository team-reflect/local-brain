import { invoke } from '@tauri-apps/api/core'
import { createDb } from '@local-brain/db'

/**
 * The app-wide Kysely instance. Reads compile to `{ sql, params }` in TypeScript
 * and execute through the Rust-owned SQLite connection via the `db_query`
 * command (added in Plan 02). Multi-table writes use named Rust commands.
 */
export const db = createDb((sql, params) => invoke('db_query', { sql, params }))
