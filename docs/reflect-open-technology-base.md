# Reflect Open Technology Base

Local Brain should borrow heavily from Reflect Open's local-first desktop architecture,
but not its markdown-as-truth storage model.

Reference repo:

```text
/Users/alex/repos/reflect-open
```

## What To Borrow

- Tauri desktop app shape.
- React/TypeScript frontend.
- Rust native layer for file-system, keychain, local processes, and database access.
- Local-first defaults.
- Directory-first workspace selection and recents.
- Sidecar CLI pattern.
- BYOK model/provider setup.
- Local embeddings direction where practical.
- Practical workspace tooling and command discipline.

## What To Change

Reflect Open is a note app. Local Brain is a personal CRM and memory layer.

Reflect Open can treat markdown files as durable knowledge and SQLite as an index.
Local Brain should treat SQLite as durable knowledge:

- typed people, organizations, projects, tasks, documents, interactions, and memories
- direct SQL migrations
- generated TypeScript DB types
- Rust-owned database access
- export as a portability feature, not the canonical store

## Desktop Architecture

Expected shape:

```text
Tauri window
  React UI
  typed IPC commands
Rust native layer
  SQLite
  migrations
  keychain
  file import/export
  sidecar CLI
```

The frontend should feel like a real local app: fast navigation, optimistic edits where
reasonable, clear diagnostics, and no dependence on a hosted account.

## Startup And Storage Root

Copy Reflect Open's startup behavior, adapted from these files:

- `/Users/alex/repos/reflect-open/apps/desktop/src/providers/graph-provider.tsx`
- `/Users/alex/repos/reflect-open/apps/desktop/src/components/graph-chooser.tsx`
- `/Users/alex/repos/reflect-open/apps/desktop/src-tauri/src/fs/mod.rs`
- `/Users/alex/repos/reflect-open/apps/desktop/src-tauri/src/fs/io.rs`
- `/Users/alex/repos/reflect-open/apps/desktop/src-tauri/src/recents.rs`

Reflect's behavior to preserve:

- The user picks a directory with the OS folder picker, not an individual storage file.
- The picked directory becomes the workspace root.
- Opening a root bootstraps the expected layout idempotently.
- The Rust layer records the active root plus a monotonic generation; stale writes are
  rejected after a root switch.
- The frontend serializes overlapping opens so UI state and Rust state cannot disagree.
- A recents list lives in the OS config directory, outside any workspace root.
- Launch auto-opens the newest recent root; if none exists or opening fails, show the
  chooser.
- Local files are served through a scoped asset protocol, not broad arbitrary file access.

Local Brain should use the same root-first model. The first-run screen asks the user to
choose or create a **brain folder**. Inside that folder Local Brain creates
`brain.sqlite`, `assets/`, and `.local-brain/` support directories. Settings and CLI
diagnostics should show the brain root first, with the derived SQLite and asset paths
under it.

## Database Direction

Use SQLite for:

- durable personal CRM records
- imported readable text
- hidden memories
- settings
- FTS indexes
- optional vector index

Derived indexes can be rebuilt. Durable records cannot depend on generated markdown.

## AI Direction

Use AI for:

- extraction from documents and interactions
- summarization for detail pages
- task suggestion
- memory cleanup

AI outputs should write structured data through the same database layer as the app and
CLI. Factual answers should cite evidence references to chunks from documents or
interactions.

## Agent Direction

Local agents should use the `brain` CLI, not the app UI. This is the primary operating
path for the product: agents write most updates and perform most reads for reports,
briefings, todo lists, and cited answers.

The CLI should expose:

- status and diagnostics
- add document
- add interaction
- add task
- remember atomic claim
- search
- today
- daily report
- todo planning
- changed records
- show record

This mirrors Reflect Open's useful sidecar pattern while giving agents a schema-aware
contract.

## UI Direction

Borrow Reflect Open's preference for a fast desktop app, but let the Picardo internal
UI influence the product surfaces:

- compact sidebar
- dense tables
- Picardo-style node graph centered on the user
- split panes
- detail pages
- restrained styling
- powerful search

Local Brain's sidebar is Today, Tasks, Network, Projects, Chat, and Settings. The
graph is the default tab inside Network.

## Security And Boundaries

For launch:

- no hosted Local Brain service
- provider keys stored in the OS keychain
- Settings controls AI provider configuration
- Extraction should send only the context needed for the operation
- app-managed backup/export is deferred

Future sync, git portability, or deeper privacy controls should be designed after the
local product loop works.
