# Plan 02 - SQLite Schema and DB Layer

**Goal:** Implement the durable SQLite schema and typed database access layer for the
personal-CRM model.

**Depends on:** Plan 01.

**Unlocks:** Plans 03-08.

## Scope

**In:** migrations, schema tests, generated TypeScript DB types, Rust-owned SQLite
access, Kysely IPC bridge, seed data.

**Out:** extraction logic, app UI polish, packaging.

## Key Decisions

- SQLite is durable storage.
- Rust owns database connections, migrations, transactions, WAL/busy-timeout settings,
  and SQLite extension loading.
- TypeScript uses Kysely as a typed SQL builder over Tauri IPC.
- TypeScript product code lives in `packages/core`; React components call core actions,
  not SQL or Tauri commands directly.
- Durable tables are typed product nouns: people, organizations, affiliations,
  projects, tasks, interactions, documents, memories, tags, chat, and settings.
- Imported readable text is stored directly on documents and interactions.
- The user's own profile is represented as a `people` row with `is_self`.
- `content_chunks` is derived from documents and interactions.
- `evidence_refs` cites exact chunks for memories, tasks, and chat answers.
- No row-level sensitivity labels for launch.

## SQLite IPC Architecture

Port Reflect Open's SQLite IPC pattern, adapted for durable Local Brain data:

```text
React UI
  -> TanStack Query hooks
  -> packages/core actions
  -> packages/db Kysely query builder
  -> Tauri IPC command: db_query / db_execute / db_batch
  -> Rust rusqlite connection
  -> local SQLite brain database
```

Rules:

- Kysely compiles SQL and params in TypeScript.
- Rust executes SQL against the owned SQLite connection.
- Reads can use generic `db_query`.
- Writes should prefer named core actions and Rust transactions. Use `db_batch` or typed
  Rust commands for multi-table writes.
- All write operations that touch multiple tables run in one transaction.
- Rust commands return serializable `AppError` values.
- The IPC wrapper validates command payloads and responses at the boundary.
- Do not row-validate hot query results from our own schema; trust generated DB types.
- Use WAL mode and a busy timeout so the desktop app and CLI can coexist.
- The durable DB path is chosen during first-run setup and exposed through Settings and
  `brain path`.

Unlike Reflect Open, deleting SQLite here loses durable data. Only derived tables and
indexes are rebuildable.

## Implementation Steps

1. Add SQL migrations for core tables:
   - `people`
   - `organizations`
   - `affiliations`
   - `projects`
   - `tasks`
   - `interactions`
   - `documents`
   - `content_chunks`
   - `memories`
   - `memory_links`
   - `evidence_refs`
   - `tags`
   - `taggings`
   - `chat_conversations`
   - `chat_messages`
   - `settings`
2. Add typed join tables:
   - interaction participants, organizations, and projects
   - project people, organizations, documents, interactions, and tasks
   - document people, organizations, projects, and interactions
   - task people, organizations, documents, and interactions
3. Add indexes for common filters:
   - active tasks by due date and status
   - projects by status
   - people and organizations by name
   - people by reconnect date and last interaction date
   - interactions by occurred date
   - documents by authored/created date
   - evidence refs by subject and chunk
   - the self person row
4. Add FTS5 tables or virtual tables for visible records and chunks.
5. Add a migration runner in Rust.
6. Add database open settings:
   - `PRAGMA foreign_keys = ON`
   - WAL mode
   - busy timeout
   - schema version/user version
   - extension loading for FTS5 and later sqlite-vec
7. Add `crates/brain-schema`:
   - SQL migrations
   - schema version constant
   - `open_and_migrate`
   - test helpers for temporary databases
   - shared by desktop and CLI
8. Add `packages/db`:
   - generated Kysely `Database` interface
   - custom IPC dialect/driver
   - `json()` helper
   - casing normalization contract
   - schema/codegen drift script
9. Add `packages/core` DB actions by domain:
   - `people/getters.ts` and `setters.ts`
   - `projects/getters.ts` and `setters.ts`
   - `tasks/getters.ts` and `setters.ts`
   - `documents/getters.ts` and `setters.ts`
   - `interactions/getters.ts` and `setters.ts`
10. Add schema snapshot tests that compare the migrated database to expected tables,
   columns, indexes, and foreign keys.
11. Generate TypeScript DB types from SQLite schema.
12. Add IPC commands for transaction-scoped CRUD and list queries.
13. Add seed/demo data that covers people, organizations, projects, tasks,
   interactions, documents, memories, and citations.

## Acceptance Criteria

- A fresh database migrates from empty to the launch schema.
- TypeScript has generated, checked DB types.
- Kysely queries execute through the Tauri IPC bridge against Rust-owned SQLite.
- Multi-table writes are transaction-scoped in Rust.
- The app can create, read, update, and archive each durable record type through IPC.
- People support relationship-intelligence hints for recency, cadence, strength, and
  important dates.
- FTS can search document and interaction text.
- Derived chunk data can be rebuilt from durable records.
- Schema docs match [Launch Schema](../launch-schema.md).

## Tests or Verification

- Run migration tests against an empty database.
- Run migration tests twice to prove idempotent startup behavior.
- Run foreign-key enforcement tests.
- Run generated-type checks.
- Run schema/codegen drift check.
- Run IPC query/execute/batch integration tests.
- Run transaction rollback tests.
- Run `pnpm check` and Cargo tests once the workspace exists.

## Open Questions

- Whether vector search lives in SQLite through an extension or in a sidecar index can
  be decided during Plan 06.
