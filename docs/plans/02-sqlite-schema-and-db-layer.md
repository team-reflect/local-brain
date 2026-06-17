# Plan 02 - SQLite Schema and DB Layer

**Goal:** Implement the durable SQLite schema, migration system, generated TypeScript
types, and Rust-owned SQLite access layer.

**Depends on:** Plan 01.

**Unlocks:** Plan 03 (UI reads), Plan 04 (source writes), Plan 05 (memory writes),
Plan 06 (search/retrieval), Plan 07 (CLI reads/writes), Plan 08 (backup/export).

## Scope

**In:** migrations, durable tables from the launch schema, derived FTS tables, Rust DB
commands, Kysely IPC bridge, schema codegen, transaction rules.

**Out:** extraction prompts, embeddings, UI workflows, import integrations beyond test
fixtures.

## Key Decisions

- SQLite runs in Rust through `rusqlite`, not in the WebView.
- SQLite is durable product storage, not a rebuildable markdown projection.
- Use ordered SQL migrations in the schema crate.
- Generate TypeScript DB types from migrations; do not hand-maintain drifting table
  types.
- Use Kysely in TypeScript as a typed query builder over Tauri IPC.
- Use `TEXT` IDs and ISO-8601 `TEXT` timestamps as described in
  [Launch Schema](../launch-schema.md).
- Keep durable tables separate from derived FTS/vector tables.

## Implementation Steps

1. Add migration infrastructure in `crates/index-schema` with ordered SQL migrations and
   a migration runner usable by desktop and CLI crates.
2. Implement the first migration with durable tables:
   `sources`, `source_chunks`, `entities`, `entity_aliases`, `memories`,
   `memory_entities`, `relationships`, `tasks`, `events`, `event_entities`,
   `chat_conversations`, `chat_messages`, and `settings`.
3. Add derived search tables for source chunks, memories, entities, and tasks using
   FTS5.
4. Add Rust DB open/migrate/query/execute/batch commands with transactions for writes.
5. Add the TypeScript Kysely bridge in `packages/db`, including JSON helper utilities
   and generated schema types.
6. Define clear read/write homes:
   - Rust owns connection lifecycle, migrations, extension loading, and transactions.
   - TypeScript owns typed query construction and product-level validation.
7. Add a small fixture migration test database for schema verification.

## Acceptance Criteria

- The app/CLI can create and migrate a new local brain SQLite database.
- Generated TS types match migrations.
- Basic typed queries compile through the Kysely IPC bridge.
- Durable tables are never wiped by derived-index rebuild helpers.
- FTS tables can be rebuilt from durable rows.

## Tests or Verification

- Rust migration tests create a database from empty and verify all expected tables.
- TypeScript tests compile representative `Selectable`, `Insertable`, and query usage.
- A DB smoke test inserts a source, chunk, entity, memory, task, and chat message.
- Rebuild tests clear and repopulate FTS without deleting durable rows.

## Open Questions

- Whether vector tables ship in this plan or Plan 06 depends on extension packaging.
  Default: add vector storage in Plan 06.
