# Build Decisions & Open Questions

Decisions made by the build supervisor and open questions that need Alex. Each entry has
an ID, status, and the rationale or the question. Resolved questions stay here for the
record.

## Needs Alex

### D1 — Rust toolchain not installed in build environment
- **Status:** OPEN — needs Alex (or environment fix).
- **Impact:** `cargo`, `rustc`, and `rustup` are not on PATH. The Rust crates
  (`crates/brain-schema`, `apps/desktop/src-tauri`, `apps/cli`) and Plan 02 migrations
  can be **authored** but cannot be `cargo check`/`cargo test`/`cargo fmt` verified in
  this session, and `pnpm tauri dev/build` cannot run.
- **Mitigation:** Author Rust code to spec, keep it isolated so TS layers stay verifiable
  with `pnpm check`, and mark every Rust verification step as `deferred (no cargo)` in
  the manifest. CI must run the Cargo checks.
- **Ask:** Either install a Rust toolchain (`rustup` + stable) in this environment, or
  confirm that CI / a follow-up session will run the Cargo gates. Until then, Rust layers
  ship as "authored, not locally built."

## Decisions (no action needed)

### DEC-1 — Stacked PRs via explicit base branches
- `gh stack` is unavailable. Using ordinary PRs, each based on the branch below it in the
  stack, with the relationship recorded in `manifest.md`. Rebase + retarget to `master`
  as lower layers merge.

### DEC-2 — Plan 02 split into 02a/02b/02c
- Schema crate (Rust) / db package (Kysely + IPC) / core actions + seed are separated for
  reviewability, per the supervisor brief's allowance to split the DB layer.

### DEC-3 — Package + binary names
- Default to `@local-brain/*` packages and `brain` CLI (per Plan 01 open question) until
  Alex renames.

### DEC-4 — Sequential build (no parallel worker sessions)
- This session drives the stack sequentially and commits from one working tree.
  Read-only research may fan out within a layer, but there is no parallel-session
  orchestration of commits. Recorded per the brief's failure-behavior contract.
