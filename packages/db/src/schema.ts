/**
 * The Kysely view of the durable SQLite schema.
 *
 * The `Database` interface and every per-table row type are generated from the
 * Rust migrations in `crates/brain-schema` by `scripts/generate-schema.mjs`
 * (run via `pnpm --filter @local-brain/db db:codegen`). Do not edit
 * `schema.gen.ts` by hand — the drift check in `scripts/check-drift.mjs`, run
 * by `pnpm test`, fails if it falls out of sync with the migrations.
 *
 * Column names are camelCase here and snake_case in SQLite; Kysely's
 * CamelCasePlugin bridges them at the dialect boundary (see `db.ts`).
 */
export type * from './schema.gen'
