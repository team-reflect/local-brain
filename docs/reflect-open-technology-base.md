# Reflect Open Technology Base

Local Brain should be based on Reflect Open's technology, not its exact storage model.

Reflect Open is a strong base because it already solves the hard local-app constraints:

- Tauri 2 desktop shell instead of Electron.
- React + TypeScript frontend.
- Rust native layer for file system, SQLite, embeddings, secrets, watchers, and sidecars.
- SQLite opened in Rust through `rusqlite`.
- Kysely in TypeScript as a typed SQL builder over a Tauri IPC bridge.
- FTS5 lexical search.
- `sqlite-vec` style local vector search.
- Local embedding runtime in Rust.
- BYOK generative AI, with no Reflect-hosted API dependency.
- Secrets stored in the OS keychain.
- Durable chat history in SQLite.
- Open-source conventions and CLI sidecars.

## What to Reuse Directly

### App Shell

Use Tauri with a React/TypeScript frontend and Rust backend. Keep the native process in
charge of SQLite, file access, embeddings, secrets, and sidecars.

### SQLite in Rust

SQLite should run in Rust, not in the WebView. This preserves:

- native extensions,
- reliable filesystem access,
- real local DB files,
- WAL locking,
- CLI access,
- better performance for vector/search work.

The frontend can compile typed SQL using Kysely and send `{ sql, params }` through a
small IPC bridge, following Reflect Open's pattern.

### Local AI Infrastructure

Reuse the split between:

- local embeddings for retrieval,
- BYOK cloud or local model providers for generation,
- OS keychain for API keys,
- explicit privacy gates before sending user context outside the machine.

### CLI Sidecar

Reflect Open's CLI sidecar idea is central. Local Brain should ship a local CLI such as
`brain`, installed with the app and discoverable by local agents.

### Generated DB Types

Reflect Open generates TypeScript schema types from SQLite migrations. Keep that
discipline so the DB contract does not drift.

## What to Change

### SQLite Is the Source of Truth

Reflect Open treats SQLite as a mostly rebuildable projection over markdown files.
Local Brain should treat SQLite as the durable source of truth.

This changes the architecture:

- Index rebuilds repair derived tables, FTS, and vectors, not the whole user's memory.
- Backups must include the SQLite database.
- Imports can preserve raw source files, but product state lives in tables.
- Migrations become more important because they change durable user data.

### Sources Are Not Only Markdown

The ingestion layer should expect many source kinds:

- markdown notes,
- plain text,
- PDFs,
- webpages,
- transcripts,
- emails,
- calendar events,
- chats,
- audio transcripts,
- screenshots,
- manual memories.

### Graph Is Structured, Not Note-Link Based

Reflect's graph is built from wiki links and note aliases. Local Brain's graph should be
built from entities, relationships, memories, events, and tasks.

### Privacy Is Per Source and Memory

Reflect uses `private: true` frontmatter as a hard cloud-AI block. Local Brain should
make privacy a database field on sources, chunks, memories, entities, tasks, and chats.

Suggested values:

```text
local
cloud_allowed
sensitive
never_external
```

The exact names can change, but the core rule should not: retrieval must know whether a
piece of context can leave the machine.

## Suggested Monorepo Shape

This mirrors Reflect Open without committing to code yet:

```text
local-brain/
  apps/
    desktop/            Tauri app
    cli/                brain CLI sidecar
  packages/
    core/               product logic, ingestion, retrieval, AI policies
    db/                 SQLite schema types and Kysely bridge
    skills/             local agent skill templates
  crates/
    index-schema/       SQLite migrations and codegen input
  docs/
```

## Architecture Loop

```text
React UI
  -> typed commands and Kysely query builders
  -> Tauri IPC
  -> Rust commands
  -> SQLite / local files / keychain / embeddings
  -> JSON rows and events
  -> TypeScript core policies
```

## Durability Model

Because SQLite is durable here, the app should separate tables into classes:

- **Durable:** sources, memories, entities, tasks, events, chats, relationships.
- **Derived:** chunks, FTS rows, embedding vectors, and denormalized search views.
- **Device-local:** window state, provider keys, recent paths, temporary queues.

Derived tables can be rebuilt. Durable tables cannot be casually wiped.

## Privacy Model

The retrieval layer must filter context before any AI call.

Local-only operations may read all allowed local data. Cloud model calls must exclude
anything marked `never_external` or `sensitive` unless the user explicitly approves a
one-off override.

Every assistant answer should be able to display:

- which sources were used,
- which memories were used,
- whether any context left the machine,
- which model/provider handled the request.

## Reflect Open Docs to Keep Close

The implementation should stay aligned with these Reflect Open documents:

- `AGENTS.md`
- `docs/reflect-v2-product-vision.md`
- `docs/reflect-v2-indexing-strategy.md`
- `docs/plans/04-local-index-sqlite.md`
- `docs/reflect-v2-sync-strategy.md`

The biggest intentional divergence is storage truth: markdown in Reflect, SQLite in
Local Brain.
