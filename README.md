# Local Brain

An agent-operated local brain with a private desktop UI. SQLite is the durable
source of truth; AI agents read and write through the `brain` CLI and local
skills. For a grounded overview of what the product is and does today, see
[`docs/current-state.md`](docs/current-state.md). See [`docs/`](docs/README.md)
for product and architecture docs, [`docs/launch/`](docs/launch/README.md) for the
install/usage guide, and [`docs/build/`](docs/build/manifest.md) for the
implementation PR stack.

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
  skills/             local agent skill definitions (built out in Plan 07)
crates/
  brain-schema/       durable SQLite migrations + open/migrate helpers
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

cargo check --workspace    # Rust crates (desktop shell, CLI, schema)
cargo test --workspace     # migration + schema tests
```

## Develop

```bash
pnpm --filter @local-brain/desktop dev   # Vite dev server only
pnpm tauri dev                           # full desktop app (requires Rust + Tauri)

cargo run -p brain-cli -- status         # the `brain` CLI against the default DB
cargo run -p brain-cli -- --json status  # machine-readable output
```

## Conventions

- Rust owns SQLite connections, migrations, transactions, and native primitives.
- Every `#[tauri::command]` returns `Result<T, AppError>`; the frontend validates
  responses with zod at the single `call()` boundary in `@local-brain/core` and
  never imports `@tauri-apps/api` directly.
- Kysely compiles SQL in TypeScript; Rust executes it. Multi-table writes run in
  Rust transactions, not through the Kysely bridge.
- SQLite is durable user data — only derived tables (chunks, FTS, vectors) are
  rebuildable. Markdown is not the storage format.
