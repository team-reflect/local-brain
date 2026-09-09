# Local Brain

An agent-operated local brain with a private desktop UI. SQLite is the durable
source of truth; AI agents read and write through the `brain` CLI and local
skills. See [`docs/`](docs/README.md) for product and architecture docs, and
[`docs/build/`](docs/build/manifest.md) for the implementation PR stack.

## Workspace layout

```text
apps/
  desktop/            Tauri 2 + React 19 desktop app
    src/              frontend (React, Vite, Tailwind v4)
    src-tauri/        Rust shell, IPC commands, AppError contract
    scripts/          sidecar build/staging
  cli/                the `brain` CLI (Rust, shipped as a Tauri sidecar)
packages/
  core/               TS product logic, IPC `call()` boundary, AppError contract
  db/                 Kysely schema/types + read-only IPC dialect
crates/
  brain-schema/       durable SQLite migrations + open/migrate helpers
skills/               bundled agent instructions, installed by the desktop app
docs/                 planning and architecture docs
```

The TypeScript split follows Reflect Open: `packages/core` owns product logic,
React components and Rust commands stay thin, and TypeScript reaches SQLite
through a Kysely-over-Tauri-IPC bridge.

## Prerequisites

- **Node** >= 22 and **pnpm** 11 (`corepack enable` to match the pinned version)
- **Rust** stable (`rustup`) with the Tauri 2 prerequisites for your OS — needed
  for the desktop shell, the `brain` CLI, and the schema crate
- macOS is the initial target platform

## Setup

```bash
pnpm install
```

## Quality gates

```bash
pnpm typecheck     # tsc --noEmit across every TS package (turbo)
pnpm lint          # oxlint over apps + packages
pnpm test          # vitest across every TS package (turbo)
pnpm check         # typecheck + lint + test

pnpm --filter @local-brain/desktop sidecar  # once before compiling the desktop crate
cargo check --workspace    # Rust crates (desktop shell, CLI, schema)
cargo test --workspace     # CLI, desktop, and migration tests
```

For check/test runs only, prefix the sidecar command with
`LOCAL_BRAIN_SIDECAR_MODE=stub` to stage the same placeholder used by CI. A real
desktop launch or package needs the built sidecar; `pnpm tauri dev` and
`pnpm tauri build` build it automatically.

Generated database types and core integration tests replay the same migrations
through `@local-brain/db/testing`. Run `pnpm --filter @local-brain/db db:codegen`
after adding a migration; `pnpm check` verifies that the committed types match.

## Develop

```bash
pnpm --filter @local-brain/desktop dev   # Vite dev server only
pnpm tauri dev                           # full desktop app (requires Rust + Tauri)

cargo run -p brain-cli -- --brain /path/to/brain status
cargo run -p brain-cli -- --brain /path/to/brain --json status
```

The CLI requires an explicit brain: use `--brain` or set `BRAIN_ROOT` to the
brain folder. The Rust CLI reads and writes SQLite directly, using the same
migrations as the desktop app; it does not execute the TypeScript core package.

## Conventions

- Rust owns SQLite connections, migrations, transactions, and native primitives.
- Every `#[tauri::command]` returns `Result<T, AppError>`; the frontend validates
  responses with zod at the single `call()` boundary in `@local-brain/core` and
  never imports `@tauri-apps/api` directly.
- Kysely compiles SQL in TypeScript; Rust executes it. Multi-table writes run in
  Rust transactions, not through the Kysely bridge.
- SQLite is durable user data — only derived tables (chunks, FTS, vectors) are
  rebuildable. Markdown is not the storage format.
