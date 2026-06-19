# Rust Quality Refactor — Status

## Baseline (verified before changes)

- `cargo fmt --all -- --check`: clean.
- `cargo test -p brain-schema -p brain-cli`: green (schema 15 tests + CLI
  unit/integration tests).
- `cargo clippy -p brain-schema -p brain-cli --all-targets`: 1 warning —
  `clippy::large_enum_variant` on the CLI `Command` enum (`Add { what }`).
- Desktop crate `cargo` checks require the staged `brain` sidecar to exist
  first (known repo gotcha); run `pnpm --filter @local-brain/desktop sidecar`
  before workspace-wide cargo/clippy.

## Progress

- [x] Read AGENTS.md, supervisor skill, manifests, all Rust source.
- [x] Wrote plan.md.
- [x] Split `add.rs` (3090 lines) into a 11-file `add/` module tree.
- [x] Removed duplicated plumbing: one `text::sha256_hex`, `LinkKind::as_str()`,
      extracted the duplicated interaction enrichment block.
- [x] Fixed `clippy::large_enum_variant` (boxed the `add` subcommand payload).
- [x] Rustdoc / module-doc polish (new `add/*` docs; `error.rs`, desktop
      `lib.rs` module docs).
- [x] Full verification suite (see below).
- [x] final-report.md, commit, push, PR.

## Verification results

- `git diff --check`: clean.
- `cargo fmt --all -- --check`: clean.
- `cargo clippy --workspace --all-targets`: clean (0 warnings).
- `cargo check --workspace`: clean.
- `cargo test --workspace`: 130 passed, 0 failed (1 pre-existing ignored).
- `pnpm --filter @local-brain/desktop sidecar`: built + staged.
- `pnpm --filter @local-brain/desktop build`: built (pre-existing chunk-size
  advisory only).
- `pnpm check`: not run — no TypeScript, schema.gen.ts, or docs-generated
  surface changed (Rust-only + docs/).

## Notes / decisions

- Desktop crate kept to clippy-clean + doc touch-ups only this pass; deeper
  desktop decomposition listed as a follow-up if warranted.
