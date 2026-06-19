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
- [ ] Split `add.rs` into `add/` module tree.
- [ ] Remove duplicated SHA-256 / link-kind / interaction-enrichment plumbing.
- [ ] Fix `clippy::large_enum_variant`.
- [ ] Rustdoc / invariant polish.
- [ ] Full verification suite.
- [ ] final-report.md, commit, push, PR.

## Notes / decisions

- Desktop crate kept to clippy-clean + doc touch-ups only this pass; deeper
  desktop decomposition listed as a follow-up if warranted.
