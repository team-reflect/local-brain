# Build Status

Live status log for the Local Brain implementation. Newest entries at the top.
The build supervisor updates this after every significant phase. See
[manifest.md](manifest.md) for the PR stack and [decisions.md](decisions.md) for
questions needing Alex.

## Current State

- **Phase:** 02a — SQLite schema crate (built, sqlite3-verified, cargo-verified,
  PR open).
- **Active branch:** `codex/local-brain-02a-schema` (base `…-01-foundation`).
- **Mode:** Sequential. This session builds the stack layer by layer; no parallel
  worker sessions are spawned. (Within a layer, read-only research may fan out, but
  commits are made sequentially from this session.)
- **Blockers:** none at this checkpoint.

## Log

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
- **02b** (`packages/db`): generate the Kysely `Database` interface from the
  0002 schema, add the schema/codegen drift check, expand `schema.ts` beyond the
  `schema_meta` placeholder. Verifiable with `pnpm check`.
- **02c** (`packages/core` + Rust IPC): `db_query`/`db_execute`/`db_batch`
  commands, transaction-scoped writes, domain getters/setters, seed data.
  Rust IPC commands need cargo for full verification (D1).
- Three PRs open and awaiting review: **#1** (supervisor), **#2** (foundation,
  TS gates green), **#3** (schema, sqlite3-verified). When #1 merges to `master`,
  rebase the stack and retarget bases upward.

## Verification ledger

| Layer | Command | Result |
| --- | --- | --- |
| 00 | `git diff --check` | clean |
