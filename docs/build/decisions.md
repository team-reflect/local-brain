# Build Decisions & Open Questions

Decisions made by the build supervisor and open questions that need Alex. Each entry has
an ID, status, and the rationale or the question. Resolved questions stay here for the
record.

## Needs Alex

None at this checkpoint.

## Resolved

### D1 — Rust toolchain not installed in build environment
- **Status:** RESOLVED locally on 2026-06-17.
- **Impact:** Initial Plan 00/01/02a authoring could not run `cargo check`,
  `cargo test`, or `cargo fmt` because `cargo`, `rustc`, and `rustup` were not
  on PATH.
- **Resolution:** Installed the Homebrew Rust toolchain (`cargo 1.96.0`,
  `rustc 1.96.0`) and re-ran the Rust gates locally. The foundation Tauri shell
  needed a placeholder icon set for `tauri::generate_context!()`; after adding
  it, `cargo check --workspace` and `cargo test --workspace` pass.

## Decisions (no action needed)

### DEC-1 — Stacked PRs via explicit base branches
- `gh stack` is unavailable. Using ordinary PRs, each based on the branch below it in the
  stack, with the relationship recorded in `manifest.md`. Rebase + retarget to `master`
  as lower layers merge.

### DEC-2 — Plan 02 split into 02a/02b/02c/02d
- Schema crate (Rust) / Kysely codegen (TS) / Rust IPC bridge / core actions + seed are
  separated for reviewability, per the supervisor brief's allowance to split the DB
  layer. `02c` (the Rust `db_query`/`db_execute`/`db_batch` bridge, cargo-verified) was
  split from `02d` (the TypeScript domain layer + seed, `pnpm check`-verified) so each
  PR is a single language/concern. Subsequent layers' bases shift up by one
  (`03` now bases on `…-02d-core-db`).

### DEC-3 — Package + binary names
- Default to `@local-brain/*` packages and `brain` CLI (per Plan 01 open question) until
  Alex renames.

### DEC-4 — Sequential build (no parallel worker sessions)
- This session drives the stack sequentially and commits from one working tree.
  Read-only research may fan out within a layer, but there is no parallel-session
  orchestration of commits. Recorded per the brief's failure-behavior contract.
