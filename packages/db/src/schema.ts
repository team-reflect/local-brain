/**
 * The Kysely view of the durable SQLite schema.
 *
 * Foundation ships only the `schema_meta` bookkeeping table created by the
 * initial migration in `crates/brain-schema`. The durable product tables
 * (people, organizations, affiliations, projects, tasks, interactions,
 * documents, content_chunks, memories, ...) arrive in Plan 02 (02b) and are
 * generated from the Rust migrations and drift-checked against them.
 *
 * Column names are declared in camelCase here and mapped to the snake_case
 * SQLite columns by Kysely's CamelCasePlugin at the dialect boundary.
 */
export interface SchemaMetaTable {
  key: string
  value: string
}

export interface Database {
  schemaMeta: SchemaMetaTable
}
