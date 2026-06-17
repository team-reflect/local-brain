# Plan 01 - Foundation and Toolchain

**Goal:** Create the initial monorepo scaffold and quality gates for a Reflect-derived
Tauri app without implementing product features.

**Depends on:** Plan 00.

**Unlocks:** Plan 02 (DB layer), Plan 03 (desktop shell), Plan 07 (CLI sidecar), Plan 09
(packaging).

## Scope

**In:** package manager, workspace layout, TypeScript/Rust toolchain, baseline scripts,
lint/typecheck/test conventions, minimal CI-ready checks.

**Out:** real schema migrations, UI screens, ingestion, AI calls, release signing.

## Key Decisions

- Use `pnpm` for JavaScript/TypeScript packages.
- Use a Turborepo-style workspace similar to Reflect Open.
- Use a Cargo workspace for Rust crates.
- Use Tauri 2 for the desktop shell.
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
  index-schema/
docs/
```

## Implementation Steps

1. Add root workspace files: `package.json`, `pnpm-workspace.yaml`, `turbo.json`,
   TypeScript config, formatting/lint config, and root Cargo workspace config.
2. Add empty package shells for `packages/core`, `packages/db`, and `packages/skills`
   with public entrypoints and strict TS configs.
3. Add empty Rust crate shells for the Tauri app, CLI, and schema/migration crate.
4. Add scripts matching the intended workflow:
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm test`
   - `pnpm check`
   - `pnpm dev`
   - `pnpm tauri dev`
   - `pnpm tauri build`
5. Add `.gitignore` entries for build artifacts, local DB files, local exports,
   generated sidecars, and secrets.
6. Document local setup in the root README once the scaffold exists.

## Acceptance Criteria

- A fresh clone can install dependencies with `pnpm install`.
- `pnpm check` runs without product implementation.
- Cargo workspace metadata resolves.
- No generated DB, real user data, or local secrets are tracked.
- The scaffold is compatible with later Tauri sidecar bundling.

## Tests or Verification

- Run `pnpm install`.
- Run `pnpm check`.
- Run `cargo check --workspace` after Rust crates exist.
- Confirm `git status --short` only shows intentional tracked files.

## Open Questions

- Final package scope and binary names are still working names. Default to
  `@local-brain/*` packages and `brain` CLI until renamed.
