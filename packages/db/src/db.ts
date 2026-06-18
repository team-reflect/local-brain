import { CamelCasePlugin, Kysely } from 'kysely'
import { IpcDialect } from './dialect'
import type { QueryRunner } from './dialect'
import type { Database } from './schema'

/**
 * Build a typed Kysely instance over the IPC SQLite bridge. The CamelCasePlugin
 * maps camelCase TypeScript identifiers to the snake_case SQLite schema on the
 * way down and back to camelCase on result rows.
 */
export function createDb(runQuery: QueryRunner): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new IpcDialect(runQuery),
    plugins: [new CamelCasePlugin()],
  })
}

/** Serialize a value for a JSON-valued SQLite column. */
export function json<T>(value: T): string {
  return JSON.stringify(value)
}
