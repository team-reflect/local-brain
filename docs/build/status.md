# Build Status

Live status log for the Local Brain implementation. Newest entries at the top.
The build supervisor updates this after every significant phase. See
[manifest.md](manifest.md) for the PR stack and [decisions.md](decisions.md) for
questions needing Alex.

## Current State

- **Phase:** 03a — Desktop shell (typed routing + command registry + core surfaces,
  `pnpm check` + Vite build + `cargo check` green, PR open).
- **Active branch:** `codex/local-brain-03-desktop-shell` (base `…-02d-core-db`).
- **Mode:** Sequential. This session builds the stack layer by layer; no parallel
  worker sessions are spawned. (Within a layer, read-only research may fan out, but
  commits are made sequentially from this session.)
- **Blockers:** none at this checkpoint.

## Log

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
- **03b** (`codex/local-brain-03b-desktop-shell-ii`, base `…-03-desktop-shell`): the
  user-centered Graph, the Ask chat shell, full Settings sections, organization getters
  + Network Organizations tab/detail, richer linked-record detail sections + citation
  lists, and a cmdk palette with record search; add `jsdom`/testing-library for
  component render tests. Then **04** (ingestion) onward.
- Seven PRs open and awaiting review: **#1** (supervisor), **#2** (foundation),
  **#3** (schema), **#4** (db package), **#5** (Rust IPC bridge), **#6** (core actions
  + seed), **#7** (03a desktop shell — `pnpm check` + Vite build + cargo check green).
  Plan 02 (DB layer) is complete; Plan 03 is underway (03a done, 03b next). A full
  end-to-end run of the assembled app (`pnpm tauri dev`/`build`) is still pending and is
  required before the app can be called done. When #1 merges to `master`, rebase the
  stack and retarget bases upward.

## Verification ledger

| Layer | Command | Result |
| --- | --- | --- |
| 00 | `git diff --check` | clean |
