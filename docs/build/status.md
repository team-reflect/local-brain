# Build Status

Live status log for the Local Brain implementation. Newest entries at the top.
The build supervisor updates this after every significant phase. See
[manifest.md](manifest.md) for the PR stack and [decisions.md](decisions.md) for
questions needing Alex.

## Current State

- **Phase:** 02b — DB package (generated Kysely schema + drift check, `pnpm check`
  green, PR open).
- **Active branch:** `codex/local-brain-02b-db` (base `…-02a-schema`).
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
- **02c** (`packages/core` + Rust IPC): `db_query`/`db_execute`/`db_batch` Tauri
  commands over the Rust-owned connection, transaction-scoped multi-table writes,
  `packages/core` domain getters/setters (people, projects, tasks, documents,
  interactions), and seed/demo data. Verifiable with `pnpm check` + `cargo test`.
- Four PRs open and awaiting review: **#1** (supervisor), **#2** (foundation, all
  gates green), **#3** (schema, sqlite3 + cargo verified), **#4** (db package,
  `pnpm check` green). When #1 merges to `master`, rebase the stack and retarget
  bases upward.

## Verification ledger

| Layer | Command | Result |
| --- | --- | --- |
| 00 | `git diff --check` | clean |
