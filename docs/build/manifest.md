# Build Manifest

Source of truth for the Local Brain implementation PR stack: stack order, branch names,
bases, scope, PR URLs, check status, verification commands, and caveats.

This manifest is maintained by the build supervisor. Update it whenever a stack layer
changes state. See also [status.md](status.md) and [decisions.md](decisions.md).

## Stack Strategy

- The build is a **dependency-aware stack of ordinary GitHub PRs** with explicit base
  branches. `gh stack` is not installed in this environment, so each PR records its base
  here instead of relying on a stack extension.
- Branch naming: `codex/local-brain-<NN>-<slug>`.
- Each PR is based on the branch immediately below it in the stack (not on `master`),
  so review can proceed layer by layer. When a lower PR merges to `master`, rebase the
  ones above it and retarget their base to `master`.
- Plan 02 (DB layer) is split into three stacked PRs (`02a`, `02b`, `02c`) per the
  supervisor brief, because schema + Kysely bridge + core actions is too large for one
  reviewable PR.

## Environment

| Tool | State |
| --- | --- |
| node | v25.8.0 ✓ |
| pnpm | 11.5.2 ✓ |
| gh | 2.87.3, authed as `maccman` (ssh) ✓ |
| remote | `git@github.com:maccman/local-brain.git` ✓ |
| cargo / rustc | 1.96.0, installed via Homebrew on 2026-06-17 ✓ |
| rustup | not installed; Homebrew system toolchain is sufficient for local gates |
| gh stack extension | not installed — using ordinary stacked PRs |

## Stack Layers

| # | Plan | Branch | Base | Status | PR |
| --- | --- | --- | --- | --- | --- |
| 00 | Supervisor / build tracking | `codex/local-brain-00-supervisor` | `origin/master` | open | [#1](https://github.com/maccman/local-brain/pull/1) |
| 01 | Foundation & toolchain | `codex/local-brain-01-foundation` | `…-00-supervisor` | open | [#2](https://github.com/maccman/local-brain/pull/2) |
| 02a | SQLite schema crate (Rust migrations) | `codex/local-brain-02a-schema` | `…-01-foundation` | open | [#3](https://github.com/maccman/local-brain/pull/3) |
| 02b | DB package (Kysely + IPC dialect) | `codex/local-brain-02b-db` | `…-02a-schema` | open | [#4](https://github.com/maccman/local-brain/pull/4) |
| 02c | Core DB actions + IPC commands + seed | `codex/local-brain-02c-core-db` | `…-02b-db` | pending | — |
| 03 | Desktop shell & core UI | `codex/local-brain-03-desktop-shell` | `…-02c-core-db` | pending | — |
| 04 | Record ingestion | `codex/local-brain-04-ingestion` | `…-03-desktop-shell` | pending | — |
| 05 | Memory extraction & linking | `codex/local-brain-05-extraction` | `…-04-ingestion` | pending | — |
| 06 | Search, retrieval & AI | `codex/local-brain-06-search-ai` | `…-05-extraction` | pending | — |
| 07 | CLI & agent skills | `codex/local-brain-07-cli-skills` | `…-06-search-ai` | pending | — |
| 08 | Settings, backup, export & privacy | `codex/local-brain-08-settings` | `…-07-cli-skills` | pending | — |
| 09 | Packaging & launch | `codex/local-brain-09-packaging` | `…-08-settings` | pending | — |

Status legend: `pending` → not started · `in progress` → branch exists, work underway ·
`open` → PR opened · `merged` · `blocked` (see status.md).

## Per-Layer Detail

### 00 — Supervisor / build tracking
- **Scope:** `docs/build/manifest.md`, `docs/build/status.md`, `docs/build/decisions.md`.
  No app code.
- **Verification:** `git diff --check`; markdown links resolve.
- **Caveats:** none.

### 01 — Foundation & toolchain
- **Scope (Plan 01):** pnpm + Turborepo workspace, root TS config, lint/format,
  Cargo workspace, Tauri 2 app shell under `apps/desktop`, package shells
  (`packages/core`, `packages/db`, `packages/skills`), Rust crate shells
  (`apps/desktop/src-tauri`, `apps/cli`, `crates/brain-schema`), typed IPC `call()`
  wrapper with zod + casing normalization, baseline scripts
  (`typecheck`/`lint`/`test`/`check`/`dev`/`tauri`), `.gitignore`.
- **Verification:** `pnpm install` ✓; `pnpm check` ✓ (typecheck + oxlint + 6 vitest
  tests pass); migration SQL applies under `sqlite3` ✓; `node --check` on the sidecar
  script ✓; `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓;
  `cargo test --workspace` ✓.
- **Caveats:** App icon is a generated placeholder so Tauri can compile; final icon
  polish remains a Plan 09 packaging task. Sidecar bundle wiring is deferred to Plans
  07/09.

### 02a — SQLite schema crate
- **Scope (Plan 02, steps 1–7):** `crates/brain-schema` — SQL migrations for all durable
  + join tables, indexes, FTS5, migration runner, `open_and_migrate`, WAL/foreign-keys/
  busy-timeout pragmas, schema version constant, temp-db test helpers.
- **Verification:** validated under `sqlite3` 3.51 (FTS5) — 0001+0002 apply to a
  fresh DB (33 base tables, 25 indexes, 9 triggers); FK + self-row-unique + enum
  CHECK rejections fire; FTS `MATCH` returns inserted rows; cascade deletes work;
  `integrity_check`/`foreign_key_check` `ok`. `cargo test -p brain-schema`
  passes as part of `cargo test --workspace` (9 schema tests).

### 02b — DB package (Kysely + IPC dialect)
- **Scope (Plan 02, step 8):** `packages/db` — generated Kysely `Database` interface
  for all 33 durable + join tables, custom IPC dialect/driver (foundation), `json()`
  helper (foundation), camelCase normalization, schema/codegen drift script.
- **Codegen approach:** `scripts/generate-schema.mjs` replays the
  `crates/brain-schema` migrations into an in-memory database using Node's built-in
  `node:sqlite` (no native build — robust on Node 26) and introspects it to emit
  `src/schema.gen.ts`. FTS5 virtual/shadow tables are excluded (search uses raw SQL,
  Plan 06). `scripts/check-drift.mjs` regenerates and diffs against the committed
  file; it is wired into the db package's `test` script so a stale schema fails
  `pnpm check`.
- **Verification:** `pnpm check` ✓ (typecheck + oxlint + db drift check + 4 db
  vitest tests, incl. a generated-product-column camelCase→snake_case test); drift
  check fails on a stale `schema.gen.ts` (exit 1) and passes when current (exit 0).

### 02c — Core DB actions + IPC + seed
- **Scope (Plan 02, steps 9–13):** `packages/core` domain actions
  (`people|projects|tasks|documents|interactions` getters/setters), Rust IPC commands
  (`db_query`/`db_execute`/`db_batch`), transaction-scoped multi-table writes, seed data.
- **Verification:** `pnpm check`; IPC query/execute/batch integration tests; rollback tests.

### 03–09
- Scope mirrors `docs/plans/03..09`. Detail is filled in as each layer starts; see the
  plan docs for deliverables, and `status.md` for live progress. 03 = desktop shell &
  seven surfaces; 04 = ingestion; 05 = extraction; 06 = search/retrieval/Ask;
  07 = `brain` CLI + skills (sidecar via `bundle.externalBin`); 08 = settings/backup/
  export; 09 = macOS packaging, first-run, signing checklist.

## Open / Updated PR URLs

- PR #1 — Build 00 supervisor docs — https://github.com/maccman/local-brain/pull/1 (base `master`, open)
- PR #2 — Build 01 foundation scaffold — https://github.com/maccman/local-brain/pull/2 (base `…-00-supervisor`, open)
- PR #3 — Build 02a launch schema — https://github.com/maccman/local-brain/pull/3 (base `…-01-foundation`, open)
- PR #4 — Build 02b db package (Kysely codegen + drift check) — https://github.com/maccman/local-brain/pull/4 (base `…-02a-schema`, open)
