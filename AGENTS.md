# Agent Notes

## Purpose

This document helps AI agents and automated systems work in Local Brain safely and
effectively. It summarizes product principles, development workflow, repo boundaries,
verification, and the Reflect Open patterns agents should reuse.

## Required Context

Before starting work, read `docs/README.md`. For implementation work, also read:

- `docs/plans/architecture-conventions.md`
- `docs/plans/libraries.md`
- the relevant product, schema, or numbered plan docs for the surface you are touching

For comparable desktop, CLI, database, search, AI, or UI behavior, inspect
`/Users/alex/repos/reflect-open` and reuse its proven patterns unless Local Brain has
a product-specific reason to diverge. Do not port Reflect Open's
markdown-as-source-of-truth assumptions.

## Product Principles

Local Brain is an agent-operated local-first personal CRM and memory app. The repo is
a Tauri monorepo on Reflect Open's desktop technology base: a `brain` CLI and skills
for agent writes/reads, a desktop UI for browsing and correction, and SQLite as the
durable source of truth.

- **Agent-first operation.** Most writes and reads should come from AI agents through
  the CLI/skill contract, for example daily automations, todo planning, briefings,
  and memory updates.
- **SQLite is durable truth.** Durable data lives in SQLite plus app-managed assets.
  Derived indexes can be rebuilt; markdown export is a portability feature, not the
  canonical store.
- **No hosted Local Brain APIs for MVP.** AI provider calls are BYOK and direct to
  user-approved providers. Do not add a hosted Local Brain model proxy.
- **Secrets stay in the OS keychain.** Model keys, credentials, and integration
  secrets never belong in SQLite, markdown, Git, logs, or local config files.
- **Chat writes require approval.** Chat uses the Vercel AI SDK from the desktop
  webview. Provider keys are fetched into webview memory only for a user-approved Chat
  request, and Chat write tools must require explicit user approval before mutating
  SQLite.
- **Provider-neutral CLI.** The CLI exposes typed Local Brain operations and generic
  source/external identity fields. It must not know about `gws`, Gmail, Granola,
  Google Contacts, Apple Contacts, or other upstream connector APIs.
- **Keyboard-native sparse UI.** The UI is for browsing, correction, inspection, Chat,
  and demonstration. Keep it keyboard-friendly and avoid surfaces that compete with
  the agent-operated workflow.
- **Evidence and provenance first.** Provenance lives directly on documents,
  interactions, memories, tasks, and evidence links. Factual answers should cite
  evidence references.
- **Use product nouns precisely.** A brain is the top-level local workspace. The Graph
  is the Network visualization inside a brain. Do not use these words
  interchangeably.

Current user surfaces are Today, Tasks, Network, Projects, Graph, Chat, and Settings.
Network contains People and Organizations. Documents and Interactions are first-class
records, but they are browsed inside person, organization, project, and task detail
pages, and through search or Chat.

## Development Workflow

Development happens on `master` unless the user or repository state indicates another
integration branch. When a requested change is complete and verified, proactively
create a pull request unless the user has asked you not to. Branch from the current
integration branch, use the `codex/` branch prefix by default, and target the
integration branch with the PR.

1. Check `git status --short` before editing. You may be in a dirty worktree; never
   overwrite or revert unrelated user changes.
2. Create a short plan and get signoff before proceeding.
3. Make your changes. Keep product docs, schema docs, generated DB types, and numbered
   plans aligned when you touch durable product or schema behavior.
4. Run focused checks for what changed:
   - TypeScript: `pnpm typecheck`, `pnpm lint` or `pnpm lint:fix`
   - Vitest: `pnpm test --run path/to/test` or the relevant package test
   - Database/schema: `pnpm --filter @local-brain/db db:codegen` when schema types
     need regeneration, and `pnpm --filter @local-brain/db test` for drift checks
   - Rust: `cargo test -p brain-cli`, `cargo test -p brain-schema`, or
     `cargo test -p local-brain-desktop` for relevant crate targets
5. For native, CLI, migration, or database changes, also run the relevant `cargo fmt`,
   `cargo clippy`, and `cargo test` targets.
6. Before declaring work done, run `pnpm check` (typecheck + lint + test). For native,
   CLI, migration, or database changes, also run the relevant cargo checks.
7. If the change is complete and verified, open a PR unless the user asked you not to
   or the work was only exploratory/proposal-only.

Before any `cargo` build/check/test that compiles the desktop crate, stage the CLI
sidecar once per checkout:

```bash
pnpm --filter @local-brain/desktop sidecar
```

`pnpm tauri dev` and `pnpm tauri build` stage it automatically.

Do not perform smoke tests by default. Do not start the desktop app, run
`pnpm tauri dev`, run `pnpm tauri build`, or do manual click-through verification
unless the user explicitly asks.

Common commands (repo root):

```bash
pnpm dev              # turbo dev across packages
pnpm tauri dev        # full desktop app with hot reload
pnpm check            # typecheck + lint + test
pnpm --filter @local-brain/desktop sidecar
```

## Repo Layout

```text
local-brain/
+-- apps/
|   +-- desktop/          # @local-brain/desktop: Tauri 2 + React app
|   +-- cli/              # brain: Rust CLI sidecar and supported agent interface
+-- packages/
|   +-- core/             # TS actions, product policy, retrieval, AI orchestration
|   +-- db/               # Kysely schema/types, codegen, and drift checks
|   +-- skills/           # packaged local skill helpers
+-- crates/
|   +-- brain-schema/     # SQLite migrations, open/migrate helpers, schema version
+-- skills/               # local agent skills
+-- docs/                 # product, architecture, schema, and implementation plans
```

## Architecture Boundaries

- Rust owns database connections, migrations, transactions, SQLite extension loading,
  keychain access, file-system access, native packaging concerns, and Tauri commands.
- TypeScript owns product policy, orchestration, retrieval, AI context assembly, and
  UI view models.
- React components call core actions through hooks. They should not contain SQL,
  AI/provider logic, extraction logic, or direct Tauri `invoke` calls.
- Tauri `#[command]` handlers should be thin wrappers over native primitives. They
  should not encode product rules beyond the primitive they expose.
- Use one IPC boundary module for frontend calls into Rust. Components and hooks never
  import `@tauri-apps/api` directly.
- Rust commands are named `snake_case` and return `Result<T, AppError>`.
- Frontend wrappers validate command payloads and responses with Zod at the boundary.
- Normalize database/native `snake_case` to frontend `camelCase` once in the bridge
  layer.
- Use Kysely as the typed SQL builder from TypeScript. Rust executes compiled SQL and
  params against SQLite.
- The `brain` CLI is the supported agent interface. Commands should offer JSON output;
  stdout carries data only, while diagnostics and warnings go to stderr.

## Code Conventions

- Use Tauri 2 for the desktop shell. Do not introduce Electron.
- Use TypeScript strictly: no `any` or `as any`.
- Prefer small, composable, testable modules with clear public APIs.
- Use kebab-case for files and directories.
- Use named exports for React components.
- Keep one component per file by default.
- Use providers plus small hooks for shared React state.
- Never call hooks conditionally.
- Use Zod at external and JSON boundaries.
- Use discriminated unions and type guards for state that has variants.
- Keep types close to where they are used; move shared types to dedicated `types.ts`
  files when they become shared.
- Prefer function declarations for public helpers. Public functions should have
  explicit return types.
- Add succinct comments only for non-obvious decisions or complex logic.
- Treat tests as documentation for behavior.
- Always write documentation for public APIs.

## UI Conventions

- Follow `docs/design-system.md` and Reflect Open's component patterns.
- Check existing shadcn/ui primitives before building custom interactive controls,
  overlays, dialogs, menus, popovers, sheets, comboboxes, command menus, or tooltips.
- If shadcn already covers the needed primitive but it is missing locally, install or
  generate it into `apps/desktop/src/components/ui` and use it.
- Use Lucide icons where appropriate.
- Keep the UI compact, responsive, keyboard-friendly, and oriented around browsing,
  correction, inspection, Chat, and demonstration.
- Do not add top-level surfaces for documents or interactions; they appear in detail
  pages, search results, and Chat.

## Documentation Style

- Keep plans decision-oriented and compact.
- Use ASCII diagrams where they clarify schema or UI.
- Prefer durable product language over implementation names unless the doc is a
  technical plan.
- Keep product docs, schema docs, and numbered implementation plans aligned when
  durable behavior changes.
