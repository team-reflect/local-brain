# Build Status

Live status log for the Local Brain implementation. Newest entries at the top.
The build supervisor updates this after every significant phase. See
[manifest.md](manifest.md) for the PR stack and [decisions.md](decisions.md) for
questions needing Alex.

## Current State

- **Phase:** 04c — Ingestion UI: an `AddRecordDialog` (document/interaction, paste or
  folder import, link pickers, load-from-path, duplicate notice) wired to the 04a ingest
  functions + 04b file readers, plus an Add button and `new.document`/`new.interaction`
  palette commands. `pnpm check` + Vite build + `cargo check` green, PR open. **Plan 04 is
  now complete** (04a/04b/04c).
- **Active branch:** `codex/local-brain-04c-ingestion-ui` (base `…-04b-ingestion-fs`).
- **Mode:** Sequential. This session builds the stack layer by layer; no parallel
  worker sessions are spawned. (Within a layer, read-only research may fan out, but
  commits are made sequentially from this session.)
- **Blockers:** none at this checkpoint.

## Log

### 2026-06-17 — Phase 04c: Ingestion UI (Plan 04 complete)
- Built `AddRecordDialog`: a Document/Interaction toggle and a Paste/Import-folder mode
  toggle. Paste mode has title/kind/date, a body textarea, an optional "load from file path"
  (calls `readTextFile`), and collapsible people/projects/organizations/tasks link pickers;
  Save runs `ingestDocument`/`ingestInteraction`, shows the duplicate notice, and navigates
  to the record. Folder mode scans a path with `readTextFolder` then ingests each file,
  reporting imported/duplicate/skipped counts.
- Wired it in: added `openAdd` to `CommandContext`, pointed the `new.document` /
  `new.interaction` palette commands at it, added an **Add** button to the command bar, and
  gave `AppShell` the dialog state. Added `useIngestDocument` / `useIngestInteraction`
  mutations (broad invalidation).
- **Decision (DEC-11):** file/folder selection is a typed **path field**, not a native
  picker — keeps the build hermetic and the dialog render-testable without the Tauri dialog
  plugin; the native picker is a follow-up.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + **61 tests** (27 core, 4 db, 30
  desktop incl. 4 new `AddRecordDialog` render tests). `pnpm --filter @local-brain/desktop
  build` ✓ (2041 modules). `cargo check --workspace` ✓ (no Rust this layer). `git diff
  --check` ✓.

### 2026-06-17 — Phase 04b: Rust safe file-read primitives
- Built `apps/desktop/src-tauri/src/fs.rs`: `read_text_file` (canonicalize the
  user-selected path, require a regular file, 5 MiB size cap, require valid UTF-8, detect
  kind by extension, SHA-256 the bytes, clear typed errors otherwise) and `read_text_folder`
  (recursive scan that skips hidden / unsupported / oversized / binary / duplicate files and
  anything resolving outside the chosen root via a symlink, returning per-file skip reasons +
  imported/skipped counts). Registered both commands in `lib.rs`; added `sha2` to the
  workspace; added typed `readTextFile`/`readTextFolder` zod bindings in
  `packages/core/src/ipc/fs.ts`.
- **Hashing:** the Rust hash is SHA-256 over the file's raw UTF-8 bytes (intra-scan dup
  flagging only); the authoritative cross-record dedupe hash stays the 04a one, computed at
  ingest over normalized text, so 04c will pass `contents` through `ingestDocument`.
- **Verification:** `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓;
  `cargo test --workspace` ✓ — 12 tests (3 new `fs` tests + 9 existing); `pnpm check` ✓
  (the new bindings typecheck; 57 JS tests unchanged); `git diff --check` ✓.

### 2026-06-17 — Phase 04a: Ingestion core engine (Plan 04 split)
- Split Plan 04 into **04a** (this PR — the TS ingestion engine), **04b** (Rust safe
  file-read primitives), and **04c** (ingestion UI), recorded as DEC-10; shifted Plan 05's
  base to `…-04c-ingestion-ui`.
- Built `packages/core/src/ingest`: `normalizeText` + paragraph-aware `chunkText` (pure,
  unit-tested); `contentHash` (SHA-256 hex via Web Crypto, matching the future Rust `sha2`
  path so pasted and imported copies dedupe); `ingestDocument` / `ingestInteraction` that
  normalize → hash → dedupe-check → write the record + `content_chunks` + optional
  people/orgs/projects/tasks links in one `db_batch`; and an `extraction-queue` seam
  (`markForExtraction`/`setExtractionHandler`, no-op until Plan 05 step 10).
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + **57 tests** (27 core incl. 6
  chunk/normalize unit tests + a new real-SQLite ingestion block: normalized body + chunks
  + content hash + links, duplicate detection + `allowDuplicate`, interaction participant
  links, atomic rollback on an invalid link FK; 4 db; 26 desktop). `cargo check --workspace`
  ✓ (no Rust this layer). `git diff --check` ✓.

### 2026-06-17 — Phase 03b: Desktop shell II (Plan 03 complete)
- Built the 03b read getters in `@local-brain/core` (all over the existing `db_query`
  bridge — no Rust changes): organizations getters/setters; a `relations` module that
  returns each record's typed join-table neighborhood as navigable `LinkedRecord`s;
  memories (`listMemoriesForRecord`); citations/evidence (`listCitationsForSubject`,
  `listEvidenceFromDocument`); chat conversations/messages (getters + `createConversation`
  / `addMessage` that writes the message and touches the conversation in one batch); a
  user-centered `getGraph` assembler (self-hub + join-table edges, per-kind node caps with
  `truncatedKinds`); and a `quickSearch` LIKE getter for the palette.
- Built the surfaces: an SVG **Graph** (a pure, unit-tested `graph-layout` radial layout,
  click-to-navigate nodes, a kind legend, and a truncation note); the **Ask** chat shell
  (conversation list + thread + composer; persists a clearly-labeled Plan-06 placeholder
  answer — DEC-8); full **Settings** sections wired to the `settings.section` route param;
  the **Network → Organizations** tab + organization detail; richer
  **person/org/project/task/document/interaction** detail pages with shared `LinkedRecords`,
  `CitationList`, and `MemoryList` components; and a command palette with live record search
  + arrow-key navigation (kept hand-rolled instead of pulling in `cmdk` — DEC-7). Coalesced
  the single-record query hooks to `null` so TanStack Query never sees `undefined` data.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + **47 tests** (17 core incl. a new
  real-SQLite round-trip block over the seed: organizations, person links, memories +
  citations, graph assembly, chat threads, quick-search; 4 db; 26 desktop incl. the
  `graph-layout` unit tests and jsdom/Testing-Library render tests for `RouteContent`, the
  palette record search + keyboard nav, and `LinkedRecords` — DEC-9). `pnpm --filter
  @local-brain/desktop build` ✓ (Vite bundles 2039 modules). `cargo check --workspace` ✓
  (unchanged — no Rust this layer). `git diff --check` ✓. A full assembled `pnpm tauri
  dev`/`build` launch was not run (no GUI session); still pending.

### 2026-06-17 — Stack hygiene: propagate foundation fixes down
- The parent's `6abc16c` ("Verify Rust workspace") mixed three layers. Split it so
  each PR reviews cleanly and compiles standalone: the foundation-only changes
  (`Cargo.lock`, the placeholder Tauri icon set, the `gen/schemas/` ignore, and the
  `cargo fmt` of the app crates) moved down to **#2** as `a11800d`; **#3** was
  rebuilt on top so it carries only the schema work (`0002` migration + tests). #3's
  tree is byte-identical to the previously-verified `6abc16c` (asserted with
  `git diff backup/02a-schema …`). Backup tags kept for every original branch tip.
- Re-verified both branches: **#2** `pnpm check` ✓, `cargo fmt --all -- --check` ✓,
  `cargo check --workspace` ✓, `cargo test --workspace` ✓ (5 brain-schema tests);
  **#3** the same plus 9 brain-schema tests. Pushed (#2 fast-forward, #3
  force-with-lease) and left explanatory PR comments.

### 2026-06-17 — Phase 03a: Desktop shell (routing, commands, core surfaces)
- Split Plan 03 into **03a** (this PR — the shell skeleton + data-backed core surfaces)
  and **03b** (Graph, Ask, full Settings, org browsing, richer detail, cmdk palette);
  recorded as DEC-5. Subsequent layer bases shifted to `…-03b-…`.
- Built the typed routing layer: a discriminated-union `Route` with URL serialize/parse
  (`routing/route.ts`) and an in-memory history router with back/forward synced to
  `window.history` (`routing/router.tsx`). Added a central command/keymap registry with
  a duplicate-id guard, `Mod-…` keybinding parsing/matching, global shortcuts, and a
  minimal command palette (`lib/commands/*`).
- Built the app shell (collapsible sidebar over the seven sections, a top command bar
  with back/forward + ⌘K, and the route switch) and shared primitives (page head, dense
  data list, section, detail fields, empty state). Wired the **Today, Tasks (status
  filter + inline complete/archive), Network→People, and Projects** surfaces plus
  **person/project/task/document/interaction** detail pages to the `@local-brain/core`
  getters/setters through TanStack Query, with seed-on-first-run. Graph, Ask, Settings,
  and Organizations are placeholders for 03b.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + 11 desktop tests (route
  serialize/parse round-trips for every route kind; command registry + the
  duplicate-keybinding guard the plan calls for). `pnpm --filter @local-brain/desktop
  build` ✓ (Vite bundles 2025 modules). `cargo check --workspace` ✓. `git diff --check`
  ✓.

### 2026-06-17 — Phase 02d: Core DB actions + seed (Plan 02 complete)
- Built the TypeScript domain layer in `packages/core`: a shared Kysely client over
  the bridge (`db/client.ts`); `execute`/`batch` write bindings that `.compile()` a
  Kysely insert/update and send the SQL to `db_execute`/`db_batch` so Rust owns the
  transaction (`db/commands.ts`); ULID id generation (`db/id.ts`); and getters/setters
  for people, projects, tasks, documents, interactions. `createInteraction` writes the
  interaction and its participant links in a single `batch` (multi-table, atomic).
- Added `seedDemoData()`: an idempotent, single-transaction insert of a coherent demo
  dataset — self + two people, an organization + affiliation, a project, two tasks, a
  meeting with a participant, a document + derived content chunk, a memory linked to a
  person, an evidence citation into that chunk, and a tag.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + 11 core tests. Two layers of
  testing: a typechecked capturing-bridge unit test (asserts each action compiles the
  right SQL/params) and a `node:sqlite`-backed integration test (`.test.mjs`) that runs
  the real getters/setters and seed against the actual migrations — create→read→
  complete→archive across domains, idempotent seed, and an atomic batch rollback when a
  participant FK is invalid. No native deps (built-in `node:sqlite`).

### 2026-06-17 — Phase 02c: Rust IPC DB bridge
- Split the original Plan-02c (Rust IPC + core actions + seed) into **02c** (the Rust
  bridge, cargo-verified) and **02d** (the TypeScript domain layer + seed,
  `pnpm check`-verified) so each PR is one language/concern. Recorded in
  [manifest.md](manifest.md) and [decisions.md](decisions.md) (DEC-2); shifted the
  bases of layers 03–09 up by one.
- Built `apps/desktop/src-tauri/src/db`: a managed `DbState` (the single durable
  `rusqlite::Connection` behind a `Mutex`); `db_query` runs read-only statements only
  (rejects anything `!stmt.readonly()`), `db_execute` runs one write, and `db_batch`
  runs every statement inside one transaction that rolls back on any error. Added
  JSON↔SQLite param/row conversion (scalars map directly; arrays/objects round-trip as
  JSON text for `json()` columns) and `From<rusqlite::Error>`/`From<SchemaError>` for
  `AppError`. `lib.rs` now opens + migrates the database at startup (path resolved like
  the CLI: `$BRAIN_DB` → platform data dir) and registers the three commands; the
  desktop's Kysely runner already targets `db_query`.
- **Verification:** `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓;
  `cargo test --workspace` ✓ — 6 new desktop bridge tests (execute+query round-trip,
  read-path write rejection, NULL serialization, JSON-param round-trip, atomic batch
  commit, batch rollback on a FK violation) plus 9 brain-schema tests; `git diff
  --check` ✓; `pnpm check` ✓ (unaffected).

### 2026-06-17 — Phase 02b: DB package (Kysely codegen + drift check)
- Authored `packages/db/scripts/generate-schema.mjs`: replays the
  `crates/brain-schema` migrations into an in-memory database via Node's built-in
  `node:sqlite` (chosen over `better-sqlite3` + `kysely-codegen` to avoid a native
  build on Node 26) and introspects `PRAGMA table_info` to emit `src/schema.gen.ts`
  — the `Database` interface plus a row type for each of the 33 durable + join
  tables, camelCase columns, `Generated<T>` for defaulted/`DEFAULT` columns, and
  `… | null` for nullable columns. FTS5 virtual/shadow tables are excluded (search
  uses raw SQL, Plan 06).
- `src/schema.ts` now re-exports the generated types; `src/index.ts` re-exports the
  full schema. Added `scripts/check-drift.mjs`, wired into the db package's `test`
  script, which regenerates and diffs against the committed file (proven: exit 1 on
  a stale file, exit 0 when current).
- Added a dialect test that drives the generated `people` types end-to-end
  (`fullName`→`full_name`, `isSelf`→`is_self`, etc.) through the CamelCasePlugin.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + db drift check + 4 db
  vitest tests (and the existing core tests). No new dependencies.

### 2026-06-17 — Phase 02a: SQLite schema crate
- Parent review installed the Homebrew Rust toolchain (`cargo 1.96.0`, `rustc
  1.96.0`), added the missing placeholder Tauri icon set required by
  `tauri::generate_context!()`, formatted Rust sources, and verified:
  `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓; `cargo test
  --workspace` ✓ (including 9 `brain-schema` tests).
- Authored `crates/brain-schema/migrations/0002_launch_schema.sql`: the full
  launch schema from docs/launch-schema.md — 16 durable tables + 16 typed join
  tables, 25 filter indexes (incl. a partial unique index for the single self
  person row), enum CHECK constraints on polymorphic `record_type`/`subject_type`
  columns, and FTS5 (external-content + sync triggers) over documents,
  interactions, and content chunks.
- Bumped `LATEST_SCHEMA_VERSION` to 2; added the migration to the runner; added
  5 Rust tests (durable tables exist, FK enforced, single self row, FTS indexes
  body text, plus the existing version/idempotency tests).
- **Verification (sqlite3 3.51, FTS5-capable):** applied 0001+0002 to a fresh DB
  → 33 base tables, 25 indexes, 9 triggers; FK violation rejected; second
  `is_self=1` rejected; FTS `MATCH 'planning'` returns the inserted doc; deleting
  a memory cascades its links; bad `subject_type` rejected; `PRAGMA
  integrity_check` and `foreign_key_check` both `ok`.

### 2026-06-17 — Phase 01: foundation scaffold
- Extracted Reflect Open's exact config patterns via a 5-way parallel read
  (root workspace, Tauri/Rust shell, Vite/Tailwind frontend, Kysely-IPC bridge,
  CLI sidecar) and adapted them to Local Brain naming (`@local-brain/*`, `brain`
  CLI, `brain-schema` crate, `local_brain_lib`).
- Built the monorepo: pnpm + Turborepo workspace, shared strict `tsconfig.base`,
  oxlint config, root Cargo workspace, `.gitignore`, root README.
- `packages/core`: `AppError` contract, IPC bridge abstraction, typed `call()`
  zod boundary, `app_version` binding + 3 vitest tests.
- `packages/db`: read-only Kysely `IpcDialect`, `createDb`/`json` helpers,
  placeholder `schema_meta` Database type + 3 vitest tests (camelCase→snake_case
  compile, transaction refusal, non-array guard).
- `packages/skills`: shell + skill manifest type.
- `apps/desktop`: React 19 + Vite + Tailwind v4 frontend, warm-paper design
  tokens in `globals.css`, `cn()`, Tanstack Query client, Tauri bridge install,
  Kysely runner over `db_query`, an App that exercises the typed IPC path.
- `apps/desktop/src-tauri`: Tauri 2 shell, `AppError` enum (camelCase tagged),
  `app_version` command, capabilities, `tauri.conf.json`.
- `apps/cli`: `brain` CLI (clap, `--json`, `status`/`path`, DB-path resolution,
  open/migrate via shared schema crate, typed exit codes).
- `crates/brain-schema`: migration runner, `open_and_migrate`, WAL/FK/busy-timeout
  pragmas, `0001_init.sql` (`schema_meta`), version constant + 5 tests.
- `apps/desktop/scripts/build-sidecar.mjs`: stages the `brain` sidecar.
- **Verification:** `pnpm install` ✓; `pnpm check` ✓ (4 packages: typecheck +
  oxlint + 6 tests); migration SQL applies under `sqlite3` ✓; `node --check` on
  the sidecar script ✓; tree clean (only intentional files). Cargo gates
  **deferred** (D1 — no toolchain locally).

### 2026-06-17 — Phase 00 start
- Verified environment: clean tree at `f3616d3`; node v25.8.0; pnpm 11.5.2; gh 2.87.3
  authed as `maccman`; remote `git@github.com:maccman/local-brain.git`.
- Confirmed reference repos readable: `/Users/alex/repos/reflect-open` (clean,
  `4f92fe5`) and `/Users/alex/repos/picardo-internal-ui` (clean, `5f5ef8a`).
  `/Users/alex/repos/local-brain` is a symlink to this working copy.
- Read AGENTS.md, docs/README.md, plans 00–09, architecture-conventions, libraries,
  design-system, reflect-open-technology-base.
- **Discovered blocker:** `cargo`/`rustc`/`rustup` not installed. Recorded as D1.
- Created branch `codex/local-brain-00-supervisor` from `origin/master`.
- Authored `docs/build/manifest.md`, `status.md`, `decisions.md` and laid out the
  dependency-aware PR stack (Plan 02 split into 02a/02b/02c).

- Committed (`5c02ab5`), pushed, opened **PR #1** (base `master`).

### Next
- **05** (`codex/local-brain-05-extraction`, base `…-04c-ingestion-ui`): memory
  extraction & linking per `docs/plans/05-memory-extraction.md` — the ingestion extraction
  seam (`setExtractionHandler`, 04a) is ready to receive a handler.
- Eleven PRs open and awaiting review: **#1** (supervisor), **#2** (foundation), **#3**
  (schema), **#4** (db package), **#5** (Rust IPC bridge), **#6** (core actions + seed),
  **#7** (03a desktop shell), **#8** (03b desktop shell II), **#9** (04a ingestion core),
  **#10** (04b Rust file-read primitives), **#11** (04c ingestion UI — `pnpm check` + Vite
  build + cargo check green). Plans 02 (DB layer), 03 (desktop shell), and 04 (ingestion)
  are complete. A full end-to-end run of the assembled app (`pnpm tauri dev`/`build`) is
  still pending and is required before the app can be called done. When #1 merges to
  `master`, rebase the stack and retarget bases upward.

## Verification ledger

| Layer | Command | Result |
| --- | --- | --- |
| 00 | `git diff --check` | clean |
