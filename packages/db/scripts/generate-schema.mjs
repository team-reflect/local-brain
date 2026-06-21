// Generate the Kysely `Database` interface from the Rust migrations.
//
// Source of truth is crates/brain-schema/migrations/*.sql. This script replays
// every migration into an in-memory SQLite database (Node's built-in
// `node:sqlite`, so there is no native dependency to build), introspects the
// resulting tables with `PRAGMA table_info`, and emits packages/db/src/schema.gen.ts.
//
// Run it with `pnpm --filter @local-brain/db db:codegen`. The drift check in
// check-drift.mjs (wired into `pnpm test`) regenerates the same source and fails
// if the committed file is stale, so the generated types can never silently
// diverge from the migrations.
//
// Columns are snake_case in SQLite and camelCase in TypeScript; the
// CamelCasePlugin bridges the two at the dialect boundary (see db.ts), so this
// file maps both column identifiers and table keys to camelCase. Read-only SQL
// views are included with select-only columns. FTS5 virtual tables and their
// shadow tables are excluded — search uses raw SQL (Plan 06), not the typed
// query builder. The sqlite-vec (vec0) virtual tables are likewise excluded;
// their CREATE statements are stripped before replay because Node's built-in
// SQLite lacks the extension (see stripVec0).

import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const migrationsDir = join(repoRoot, 'crates', 'brain-schema', 'migrations')
const outputFile = join(here, '..', 'src', 'schema.gen.ts')

/** Tables that never belong in the typed query builder. */
function isExcluded(name) {
  return name.startsWith('sqlite_') || /_fts(_|$)/.test(name)
}

/** snake_case -> camelCase. */
function toCamelCase(name) {
  return name.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase())
}

/** snake_case -> PascalCase (used for the per-table interface name). */
function toPascalCase(name) {
  const camel = toCamelCase(name)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

/** Map a SQLite declared type to a TypeScript type via column affinity. */
function tsTypeForColumn(declaredType, columnName) {
  const type = (declaredType ?? '').toUpperCase()
  if (type.includes('INT')) return 'number'
  if (type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT')) return 'string'
  if (type === '') {
    if (columnName === 'id' || columnName.endsWith('_id')) return 'string'
    if (columnName.endsWith('_at') || columnName.endsWith('_on')) return 'string'
    return 'number'
  }
  if (type.includes('BLOB')) return 'Uint8Array'
  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) return 'number'
  return 'number'
}

/**
 * Strip `CREATE VIRTUAL TABLE … USING vec0(…)` statements before replaying a
 * migration. The vec0 virtual tables (sqlite-vec) need the extension, which the
 * Rust runtime registers but Node's built-in SQLite does not have. Like the
 * FTS5 tables, they are never part of the typed query builder (semantic search
 * uses raw SQL), so dropping them from codegen costs nothing and keeps the
 * generator a pure-JS, native-dependency-free replay.
 */
function stripVec0(sql) {
  return sql.replace(/CREATE\s+VIRTUAL\s+TABLE[^;]*USING\s+vec0[^;]*;/gi, '')
}

/** Apply every migration, in lexical order, to a fresh in-memory database. */
function migratedDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  for (const file of files) {
    db.exec(stripVec0(readFileSync(join(migrationsDir, file), 'utf8')))
  }
  return db
}

/** Build the schema.gen.ts source string from the migrated database. */
export function generateSchemaSource() {
  const db = migratedDatabase()
  const relations = db
    .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
    .all()
    .filter((row) => !isExcluded(row.name))

  const interfaces = []
  for (const relation of relations) {
    const columns = db.prepare(`PRAGMA table_info("${relation.name}")`).all()
    const lines = columns.map((column) => {
      const nonNull = column.notnull === 1 || column.pk > 0
      const hasDefault = column.dflt_value !== null
      let type = tsTypeForColumn(column.type, column.name)
      if (!nonNull) type = `${type} | null`
      if (relation.type === 'view') {
        type = `SelectOnly<${type}>`
      } else if (hasDefault) {
        type = `Generated<${type}>`
      }
      return `  ${toCamelCase(column.name)}: ${type}`
    })
    interfaces.push(`export interface ${toPascalCase(relation.name)} {\n${lines.join('\n')}\n}`)
  }

  db.close()

  const databaseFields = relations
    .map((relation) => `  ${toCamelCase(relation.name)}: ${toPascalCase(relation.name)}`)
    .join('\n')

  return `${header()}
import type { ColumnType } from 'kysely'

/**
 * A column SQLite fills in when omitted (DEFAULT values, e.g. created_at):
 * optional on insert, always present on select. Mirrors kysely-codegen.
 */
export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>

export type SelectOnly<T> = ColumnType<T, never, never>

${interfaces.join('\n\n')}

export interface Database {
${databaseFields}
}
`
}

function header() {
  return `/* eslint-disable max-lines -- generated; grows with the migration set */
/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate with \`pnpm --filter @local-brain/db db:codegen\`, which replays
 * crates/brain-schema/migrations into an in-memory SQLite database and
 * introspects it. The drift check in scripts/check-drift.mjs (run by
 * \`pnpm test\`) fails if this file is stale.
 */`
}

// Write the file when invoked directly (db:codegen); stay importable for the
// drift check.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  writeFileSync(outputFile, generateSchemaSource())
  console.log(`generate-schema: wrote ${outputFile}`)
}
