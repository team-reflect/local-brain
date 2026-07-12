# Architecture Conventions

These conventions keep implementation plans aligned with Reflect Open's technology
base while preserving Local Brain's SQLite-first product model.

## Storage

- SQLite is the durable source of truth for records and relationships.
- Binary asset bytes live as ordinary files under an app-managed `assets/` directory
  in the same brain root.
- Rust owns database connections, migrations, transactions, SQLite extension loading,
  keychain access, file-system access, and native packaging concerns.
- TypeScript owns product policy, orchestration, retrieval, AI context assembly, and UI
  view models.
- TypeScript accesses SQLite through a Kysely-over-Tauri-IPC bridge.
- Derived indexes can always be rebuilt from durable tables.
- Markdown export can exist later, but markdown is not the storage format.

A **brain** is a user-selected directory, not a user-selected `.sqlite` file. This
copies Reflect Open's graph-root behavior: the first-run screen asks the user to pick
or create a folder, Rust bootstraps the expected layout inside it, and later launches
auto-open the most recently used folder. Reflect calls this root a "graph"; Local
Brain keeps "graph" for the Network visualization, see Product Nouns.

Default brain root layout:

```text
Personal Brain/
  brain.sqlite
  brain.sqlite-wal
  brain.sqlite-shm
  assets/
  .local-brain/
    meta.json
    inbox/
    rejected/
```

The set of known brains should mirror Reflect Open's recents behavior: keep a small
OS-config recents store outside any brain root, newest first, deduped by root path, and
safe to forget without touching user data. A corrupt recents store should surface a
diagnostic and never wipe the existing entries by saving an empty list over it. The
active root and a monotonic generation live in Rust state so overlapping opens or stale
writes cannot land in the wrong brain. `$BRAIN_ROOT` pins one brain root for the CLI
and automations; `--db` / `$BRAIN_DB` remain advanced escape hatches for direct
database testing. There is no implicit app-data brain fallback.

Long-running frontend workflows capture `(databasePath, generation)`. Guarded reads
must reject their result if that identity changes; native writes must pass both values
to Rust, which compares them while holding the active-connection lock and performs the
mutation in that same guarded transaction. Do not rely on a separate frontend
"still active?" check for write safety.

Durable tables:

- people
- organizations
- affiliations
- projects
- tasks
- interactions
- documents
- assets
- asset_links
- content_chunks
- memories
- memory_links
- evidence_refs
- tags
- taggings
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
- Search and AI share durable chunks, typed joins/filters, and semantic primitives.
  Purpose-specific retrieval entry points may be siblings when their result units
  differ, such as chunk retrieval and Chat's record-level candidates.
- Typed routes and a central keymap/command registry keep navigation, shortcuts,
  palette commands, deep links, and CLI parity from drifting.
- Native file operations use Rust primitives with path guards, atomic writes, and
  OS-appropriate deletion semantics.

Do not port Reflect Open's markdown-as-truth assumptions. Local Brain's SQLite database
and app-managed assets are durable user data, not a disposable projection.

## Code Organization

Per-record business logic lives in `packages/core/src/domains/<domain>/` (people,
organizations, projects, tasks, documents, interactions, memories,
settings, relations, relationships, brains, citations, maintenance). Cross-cutting
engines sit beside it at the package root: `retrieval/`, `extraction/`, `ingest/`,
`ai/`, `reports/`, `graph/`, `search/`, `embeddings/`, plus the `db/`, `ipc/`, and
`text/` infrastructure.

Use the Reflect/Picardo action vocabulary inside a domain when it helps:

- `getters.ts`: reads and view-model assembly over Kysely/IPC.
- `setters.ts`: durable mutations through the shared write helpers.
- `validators.ts`: normalization + product preconditions (see Write Boundary).
- domain files: complex engines such as retrieval, extraction, graph assembly, or daily
  brief planning.

Apply this pattern as needed, not as ceremony. A small domain can start with only
`getters.ts` and tests.

### Write Boundary

Record writes go through one consistent path so agent-written data is clean
regardless of entry point:

- `text/normalize.ts` owns the field normalizers. *Match* normalizers
  (`normalizeName` / `normalizeEmail` / `normalizeDomain`) fold case and
  punctuation for duplicate-detection keys; *storage* normalizers (`squish`,
  `trimToNull`) clean a value for durable storage while preserving its display
  form. The deterministic extraction matcher re-exports the match normalizers so
  the write boundary and matching always agree.
- Each record domain has a `validators.ts` exporting pure
  `validateNew<Record>` / `validate<Record>Patch` functions that normalize string
  fields and enforce preconditions SQLite cannot (a non-empty name/title; a
  document or interaction needs a title or body). They throw a `ValidationError`
  (`kind: 'validation'` on the shared `AppError` contract).
- `db/records.ts` provides the shared `insertRecord` / `updateRecord` /
  `archiveRecord` helpers (id generation, `updated_at`/`archived_at` stamping) so
  no domain re-implements that plumbing.
- The `brain` CLI mirrors the storage normalizers and the same preconditions in
  Rust (`apps/cli/src/commands/add.rs`), the documented twin of the TS boundary.

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

**Brain vs Graph.** A **brain** is the top-level container — one local SQLite
database, the workspace the picker switches between. The **Graph** is the Network
visualization *inside* a brain (the user-centered node view). These are different
things and the words are not interchangeable: never call the top-level container a
"graph", and never call the visualization a "brain". This is Local Brain's
deliberate rename of Reflect's "graph" (which there means the workspace) to avoid
colliding with the existing Network graph surface.

Use typed records for the visible app. Avoid introducing a generic graph-node layer
unless there is a strong reason after the MVP exists.

Documents are user-readable artifacts and reference material. Interactions are human
exchanges. Hidden memories are atomic claims derived from or added alongside visible
records.

## Provenance

Provenance belongs on the owning record:

- documents can store original path, URL, external ID, and content hash.
- interactions can store original path, URL, external ID, and content hash.
- assets can store original filename, original path, URL, content hash, MIME type, and
  dimensions.
- tasks can link back to originating documents or interactions.
- memories and extracted artifacts cite exact chunks through evidence references.
- Chat tool results remain local conversation provenance; they do not create
  `evidence_refs`.

## Asset Storage

Follow Reflect Open's attachment mechanics, adapted for SQLite durability:

- keep binary bytes as ordinary files under the selected brain root's app-managed
  `assets/` directory
- keep SQLite authoritative for asset identity, metadata, typed links, provenance, and
  deletion/archive state
- use app-relative storage paths only; absolute paths are provenance, never durable
  storage references
- write assets through Rust primitives with path traversal guards, symlink-aware
  resolution, temp-file plus rename atomic writes, and content hashing
- serve local images through Tauri's asset protocol or an equivalent scoped local file
  bridge
- treat thumbnails, OCR, descriptions, and embeddings as derived data that can be
  rebuilt from the original asset and SQLite manifest

For a brain root at `.../Personal Brain/`, the database is
`.../Personal Brain/brain.sqlite` and the asset root is `.../Personal Brain/assets/`.
Moving or backing up a brain must include the whole root.

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
- App writes maintain `content_chunks` for documents, interactions, memories, and
  profile-bearing person/organization updates in the source transaction. CLI import/
  enrichment also maintains chunks for its supported entity projections (including
  organization profiles, transcripts, AI notes, and facts).
- `retrieve()` is the chunk-oriented API. Grounded Chat's record-candidate API is a
  sibling over the same chunk joins, visibility/date filters, and semantic primitives;
  it also searches typed record fields and does not call `retrieve()`.
- Record candidates fuse direct-field, FTS, and semantic ranked lists with RRF after
  collapsing chunk hits to unique records. Recency is a tie-break for relevance and
  the primary order only for explicit chronological browse.
- Because vec0 selects global neighbors before typed joins/filters, record-oriented
  semantic search starts with an overfetched KNN pool and doubles it to a bounded ceiling
  until enough unique filtered records appear. This is bounded recall improvement, not
  a guarantee that every filtered neighbor is examined.
- Retrieval results should include an existing navigation target. First-class records
  navigate directly; derived sources such as transcripts, organization profiles,
  anchored AI notes, and sourced facts navigate to an unambiguous parent/subject.
- Durable record writes and their `content_chunks` projection must share a transaction;
  semantic joins exclude a mismatched model/hash immediately, and background work
  replaces changed vectors or prunes orphans asynchronously.
- Successful renderer mutations should invalidate the cheap embedding-status query;
  keep a 60-second background poll as the catch-up path for CLI/external writes that
  cannot signal the renderer.

Local embeddings should follow Reflect Open's pattern when enabled: `fastembed` in Rust,
off the UI thread, with vectors stored in `sqlite-vec`, model/runtime recorded for
rebuilds, and lexical fallback if unavailable.

## Chat Safety And Context

- Capture one brain identity at the start of a Chat turn. Pre/post-check reads so a
  switch discards in-flight results; pin conversation writes, generated titles, native
  mutations, and approvals to the captured path + generation.
- Keep approval identity process-local; never serialize a database path or generation
  into Chat JSON. A restored pending approval can be dismissed in its conversation, but
  execution must fail closed and ask the user to retry the request.
- Persist AI SDK message JSON, including tool calls/results, as an inspectable local
  trace. Before a later provider request, replace prior raw tool results with explicit
  elision markers; never treat them as durable `evidence_refs`.
- Supply only bounded planning metadata (record counts/date span, self, common real
  filter vocabulary, and active projects). Detail tools batch records and enforce both
  per-record and per-call text budgets, preserving requested chunk refs first.
- Bound tool rounds and make the final allowed model step synthesis-only. If a provider
  still returns no answer text, show a deterministic fallback rather than ending on an
  opaque tool trace.
- A citation is navigable only when its exact record and optional chunk ref came from a
  read tool in that same assistant message.

## UI

The sidebar top holds the **brain switcher** (the active brain's color swatch +
name, opening a keyboard-navigable menu to switch, create, or open another brain,
or jump to brain settings). Below it the navigation is:

- Today
- Tasks
- Network
- Projects
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
- Agents should add documents, interactions, assets, tasks, and memories through the CLI.
- The app does not need a top-level automation log view for launch.

## Settings

Settings owns:

- the active brain's identity: name, color, location, and schema version, plus
  the list of known brains (switch / forget / create / open)
- AI providers
- semantic search
- external-model boundary configuration

Provider keys belong in the OS keychain, not regular settings rows.

Git, sync, backup, and export mechanics should not leak into launch UI. Future sync
and backup/export flows are possible, but SQLite remains the source of truth for
records and asset metadata.

## Code Layout

Preferred future workspace shape:

```text
apps/desktop          Tauri + React app
apps/cli              Rust `brain` CLI sidecar
packages/core         TS actions, product policy, retrieval, extraction, AI orchestration
packages/db           Kysely schema/types + IPC dialect
packages/ui           optional shared React components
packages/prompts      extraction prompt contracts
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
