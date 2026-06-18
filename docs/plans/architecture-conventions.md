# Architecture Conventions

These conventions keep implementation plans aligned with Reflect Open's technology
base while preserving Local Brain's SQLite-first product model.

## Storage

- SQLite is durable storage.
- Rust owns database connections, migrations, transactions, SQLite extension loading,
  keychain access, file-system access, and native packaging concerns.
- TypeScript owns product policy, orchestration, retrieval, AI context assembly, and UI
  view models.
- TypeScript accesses SQLite through a Kysely-over-Tauri-IPC bridge.
- Derived indexes can always be rebuilt from durable tables.
- Markdown export can exist later, but markdown is not the storage format.

Durable tables:

- people
- organizations
- affiliations
- projects
- tasks
- interactions
- documents
- content_chunks
- memories
- memory_links
- evidence_refs
- tags
- taggings
- chat_conversations
- chat_messages
- settings

## Reflect Open Patterns To Reuse

Reference `/Users/alex/repos/reflect-open` before implementing any comparable surface.
The most important transferable patterns are:

- Turborepo monorepo with `apps/desktop`, `packages/core`, `packages/db`, and Rust
  crates.
- TypeScript `core` owns business logic; React components and Rust commands stay thin.
- Rust exposes native primitives through Tauri commands.
- Kysely builds typed SQL in TypeScript; Rust executes the SQL against SQLite.
- TanStack Query owns IPC/server-state caching and invalidation in the UI.
- CLI is a self-contained Rust binary shipped as a Tauri sidecar.
- Search and AI share one retrieval layer.
- Typed routes and a central keymap/command registry keep navigation, shortcuts,
  palette commands, deep links, and CLI parity from drifting.
- Native file operations use Rust primitives with path guards, atomic writes, and
  OS-appropriate deletion semantics.

Do not port Reflect Open's markdown-as-truth assumptions. Local Brain's SQLite database
is durable user data, not a disposable projection.

## Code Organization

Business logic belongs in `packages/core/src/actions/<domain>/`.

Use the Reflect/Picardo action vocabulary when it helps:

- `getters.ts`: reads and view-model assembly over Kysely/IPC.
- `setters.ts`: durable mutations, usually calling typed DB write actions.
- `validators.ts`: zod validation and product preconditions.
- `checkers.ts`: capability/model-boundary checks.
- domain files: complex engines such as retrieval, extraction, graph assembly, or daily
  brief planning.
- `index.ts`: public domain exports.

Apply this pattern as needed, not as ceremony. A small domain can start with only
`getters.ts` and tests.

React components should call core actions through hooks. They should not contain SQL,
AI/provider logic, extraction logic, or direct Tauri `invoke` calls.

Tauri `#[command]` handlers should be thin wrappers over native primitives. They should
not encode product rules beyond the primitive they expose.

## Tauri IPC And Kysely

Use one IPC boundary module for all frontend calls into Rust:

- Rust commands are named `snake_case`.
- Rust commands return `Result<T, AppError>`.
- `AppError` is a serializable discriminated error contract.
- Frontend wrappers validate command payloads and responses with zod at the boundary.
- Normalize `snake_case` to `camelCase` at the IPC boundary.
- Components and hooks never import `@tauri-apps/api` directly.

SQLite reads should use Kysely as a typed SQL builder over a custom IPC dialect/driver:

- Kysely compiles SQL and params in TypeScript.
- IPC sends `{ sql, params }` to Rust.
- Rust executes with `rusqlite` against the owned connection.
- Rows return as JSON.
- Use Kysely `Selectable<T>`, `Insertable<T>`, and `Updateable<T>` in public signatures.
- Use a shared `json()` helper for JSON-valued columns.
- Trust Kysely types for rows from our own schema; do not zod-parse every row in hot
  paths.
- Validate external data, IPC payloads, provider responses, imported files, and CLI
  input.

If the generic IPC dialect becomes painful for transactions, `RETURNING`, blob params,
or complex writes, add named typed Rust commands behind the same core action API.

## Routing And Keyboard

Use a typed route model rather than stringly page state. Routes should represent product
locations:

- Today
- Tasks
- Network tabs and detail records
- Projects and project detail
- Ask conversations
- Settings sections

Back/forward, focus restore, selected detail panes, command-palette actions, and future
deep links should all use the same route contract.

Use a central command/keymap registry:

- one command id per action
- optional keyboard binding
- command implementation in `packages/core` or app shell glue
- palette, shortcuts, and CLI parity tests reference the same command vocabulary
- no duplicate global bindings

Keyboard-native operation is a product principle for agent-native technical users.

## Product Nouns

Use typed records for the visible app. Avoid introducing a generic graph-node layer
unless there is a strong reason after the MVP exists.

Documents are user-readable artifacts and reference material. Interactions are human
exchanges. Hidden memories are atomic claims derived from or added alongside visible
records.

## Provenance

Provenance belongs on the owning record:

- documents can store original path, URL, external ID, and content hash.
- interactions can store original path, URL, external ID, and content hash.
- tasks can link back to originating documents or interactions.
- memories and chat answers cite exact chunks through evidence references.

## File And Import Safety

Even though SQLite is durable, file import should still use Rust native primitives:

- path traversal guards for every user-provided path
- canonicalize paths before reading
- atomic writes for generated files
- OS trash or explicit archive semantics before hard deletion
- content hashes for duplicate detection and idempotency
- stderr/diagnostic separation for CLI file operations

For future app-closed ingestion, prefer Reflect Open's inbox/spooler pattern: write a
typed envelope atomically into an app-controlled inbox, then let the desktop app or CLI
drain it later. Do not introduce a local HTTP server unless a native inbox cannot work.

## Search

- FTS5 is the first search path.
- Embeddings are additive and should degrade cleanly to lexical search.
- `content_chunks` is derived from documents and interactions.
- One `retrieve()` API should serve search, Ask, daily reports, graph context, and CLI
  reads.
- Ask should cite chunks and open the owning document or interaction.

Local embeddings should follow Reflect Open's pattern when enabled: `fastembed` in Rust,
off the UI thread, with vectors stored in `sqlite-vec`, model/runtime recorded for
rebuilds, and lexical fallback if unavailable.

## UI

The sidebar is:

- Today
- Tasks
- Network
- Projects
- Ask
- Settings

Network contains Graph, People, and Organizations. Graph is the default Network tab.
Documents and interactions appear in detail pages and search results, not as top-level
navigation.

Graph is a derived visualization centered on the user's own `people` row. It should
use typed records and link tables as its input, not a separate generic graph-node
storage model.

Theme reusable primitives through `globals.css`. The visual direction is defined in
[Design System](../design-system.md): the Reflect Open / Reflect Local design system —
cool-grey tokens with a single indigo accent, dense tables, Inter typography (no serif),
mono metadata, compact controls, a sunken sidebar, and token-derived graph chrome.

## Agent Access

- The `brain` CLI is the supported agent interface.
- The CLI/skill path is the primary operating path for both writes and reads.
- Daily automations should be able to update context, generate reports, and produce
  todo lists without opening the UI.
- Commands should offer JSON output.
- CLI stdout carries data only; diagnostics and warnings go to stderr.
- JSON output shapes should be stable and snapshot-tested.
- The CLI should share the Rust schema/migration crate with the desktop app.
- Agents should query before writing.
- Agents should add documents, interactions, tasks, and memories through the CLI.
- The app does not need a top-level automation log view for launch.

## Settings

Settings owns:

- model keys
- storage path
- diagnostics
- CLI and skill setup
- external-model boundary configuration

Provider keys belong in the OS keychain, not regular settings rows.

Git, sync, backup, and export mechanics should not leak into launch UI. Future sync
and backup/export flows are possible, but SQLite remains the launch source of truth.

## Code Layout

Preferred future workspace shape:

```text
apps/desktop          Tauri + React app
apps/cli              Rust `brain` CLI sidecar
packages/core         TS actions, product policy, retrieval, extraction, AI orchestration
packages/db           Kysely schema/types + IPC dialect
packages/ui           optional shared React components
packages/prompts      extraction and Ask prompt contracts
crates/brain-schema   SQLite migrations, open/migrate helpers, schema version
crates/brain-native   optional shared Rust native primitives
skills/               local agent skill
docs/                 planning and architecture docs
```

## Verification

Each implementation plan should define concrete tests. When in doubt, add:

- migration test
- IPC integration test
- Kysely schema/codegen drift test
- CLI integration test
- CLI JSON snapshot test
- agent daily automation smoke test
- UI smoke test with seed data
- markdown link check for docs changes
