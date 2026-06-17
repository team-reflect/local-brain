# Plan 01 - Foundation and Toolchain

**Goal:** Create the initial monorepo scaffold and quality gates for a Reflect-derived
Tauri app without implementing product features.

**Depends on:** Plan 00.

**Unlocks:** Plan 02 (DB layer), Plan 03 (desktop shell), Plan 07 (CLI sidecar), Plan 09
(packaging).

## Scope

**In:** package manager, workspace layout, TypeScript/Rust toolchain, baseline scripts,
lint/typecheck/test conventions, IPC conventions, minimal CI-ready checks.

**Out:** real schema migrations, UI screens, ingestion, AI calls, release signing.

## Key Decisions

- Use `pnpm` for JavaScript/TypeScript packages.
- Use a Turborepo-style workspace similar to Reflect Open.
- Use a Cargo workspace for Rust crates.
- Use Tauri 2 for the desktop shell.
- Use the Reflect Open split: TypeScript `core` owns product logic; Rust owns native
  primitives.
- Establish one IPC wrapper with zod validation and casing normalization.
- Keep app code open-source quality from the first scaffold.
- Start with this layout:

```text
apps/
  desktop/
  cli/
packages/
  core/
  db/
  skills/
crates/
  brain-schema/
docs/
```

## Implementation Steps

1. Add root workspace files: `package.json`, `pnpm-workspace.yaml`, `turbo.json`,
   TypeScript config, formatting/lint config, and root Cargo workspace config.
2. Add empty package shells for `packages/core`, `packages/db`, and `packages/skills`
   with public entrypoints and strict TS configs.
3. Add the Tauri app shell under `apps/desktop` and configure React 19, Vite,
   Tailwind v4, shadcn/ui, lucide, zod, Kysely, React Query, and shared `cn()`.
4. Add Rust crate shells for the Tauri app, CLI, and schema/migration crate.
5. Add the IPC convention:
   - Rust `#[tauri::command]` handlers return `Result<T, AppError>`
   - frontend `call()` wrapper invokes commands, validates with zod, and normalizes
     casing
   - no React component imports Tauri `invoke` directly
6. Add scripts matching the intended workflow:
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm test`
   - `pnpm check`
   - `pnpm dev`
   - `pnpm tauri dev`
   - `pnpm tauri build`
7. Add `.gitignore` entries for build artifacts, local DB files, local exports,
   generated sidecars, and secrets.
8. Add CI-ready checks:
   - TypeScript typecheck
   - lint
   - Vitest
   - Cargo fmt/check/test
   - generated DB schema drift check once Plan 02 lands
9. Document local setup in the root README once the scaffold exists.

## Acceptance Criteria

- A fresh clone can install dependencies with `pnpm install`.
- `pnpm check` runs without product implementation.
- Cargo workspace metadata resolves.
- No generated DB, real user data, or local secrets are tracked.
- The scaffold is compatible with later Tauri sidecar bundling.
- A trivial Tauri command is called only through the typed IPC wrapper.

## Tests or Verification

- Run `pnpm install`.
- Run `pnpm check`.
- Run `cargo check --workspace` after Rust crates exist.
- Confirm `git status --short` only shows intentional tracked files.

## Open Questions

- Final package scope and binary names are still working names. Default to
  `@local-brain/*` packages and `brain` CLI until renamed.
