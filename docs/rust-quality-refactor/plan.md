# Rust Quality Refactor — Plan

## Objective

Make the Local Brain Rust code "insanely good quality": cohesive modules,
clear errors, safe transaction boundaries, no duplicated SQL/string plumbing,
typed helpers, clippy-clean, and useful Rustdoc — **without** changing the
public CLI/IPC behavior and without broad rewrites that defeat review.

## Starting state (baseline)

The Rust workspace is three crates and is already well-tested and documented:

- `crates/brain-schema` (595 lines) — durable SQLite schema/open/migrate. High
  quality, 15 passing tests. Light touch only.
- `apps/cli` (`brain`) — the supported agent interface. The big outlier is
  `src/commands/add.rs` at **3090 lines** in a single file.
- `apps/desktop/src-tauri` — Tauri shell + IPC bridge + embeddings. Already
  cohesive; deep refactor is out of scope for this pass.

Baseline checks (recorded in status.md): `cargo fmt --check` clean,
`cargo test -p brain-schema -p brain-cli` green, one clippy warning
(`clippy::large_enum_variant` on the CLI `Command` enum).

## Target areas (highest leverage first)

1. **Split `apps/cli/src/commands/add.rs` (3090 lines) into a cohesive
   `add/` module tree.** Pure code movement — behavior identical, verified by
   the existing extensive test suite. Proposed modules:
   - `add/mod.rs` — module docs, public re-exports, shared `report_record`,
     `source` dispatch glue.
   - `add/text.rs` — pure normalization helpers (`normalize_optional`,
     `normalize_email/phone/many/name`, `squish`, `normalize_title`,
     `valid_email`, `safe_filename`).
   - `add/identity.rs` — sources + external-identity reads/writes + generic
     content-hash dedup.
   - `add/links.rs` — `LinkKind` → join-table mapping, `insert_links`,
     `link_table`, `insert_chunks`.
   - `add/person.rs` + `add/person_import.rs` — person writes, dedupe,
     enrichment, handles; untrusted-name import assessment + its predicates.
   - `add/asset.rs`, `add/document.rs`, `add/interaction.rs`, `add/task.rs`,
     `add/memory.rs` — one entity per file with its tests.

2. **Remove duplicated plumbing:**
   - One SHA-256 hex helper (`text::sha256_hex`) instead of two
     (`text::content_hash` body + `add::hash_bytes`).
   - One `LinkKind::as_str()` instead of three open-coded `match link.kind`
     blocks (`record_type` fn, `remember`, asset links).
   - Extract the twice-duplicated interaction duplicate-path transaction block.

3. **Clippy clean:** resolve `clippy::large_enum_variant` on the CLI command
   enum (box the large `add` subcommand payloads) and any other warnings the
   workspace surfaces.

4. **Rustdoc / invariants:** tighten thin module/function docs where the split
   creates new module boundaries; document the schema/CLI/sidecar boundaries.

## Explicit non-goals

- No deep refactor of `apps/desktop/src-tauri` beyond clippy cleanliness and
  doc touch-ups (documented as a follow-up if warranted).
- No change to CLI flags, JSON output shape, exit codes, or IPC contracts.
- No schema/migration changes.
- No churn-only style edits.

## Acceptance criteria

- `add.rs` is decomposed into focused modules, each < ~600 lines, with all
  tests moved alongside their code.
- No behavior change: every existing unit + integration test passes unchanged.
- Duplicated SHA-256 / link-kind / interaction-enrichment plumbing removed.
- `cargo clippy --workspace --all-targets` is clean (or each remaining warning
  is justified in final-report.md).
- `cargo fmt --all --check`, `cargo check --workspace`, `cargo test --workspace`
  all pass.
- Desktop builds and the sidecar packages (`pnpm --filter @local-brain/desktop
  build` / `sidecar`).
- `git diff --check` clean; worktree clean at the end.

## Risks & mitigations

- **Transcription errors during the split** → rely on the compiler and the
  comprehensive existing test suite; build/test after each module is carved out.
- **Visibility churn** → use `pub(crate)`/`pub(super)` for intra-`add` helpers;
  re-export only the public arg structs + entry fns from `add/mod.rs`.
- **Desktop build needs the staged `brain` sidecar** (known gotcha) → build the
  sidecar before running desktop `cargo`/`pnpm` checks.

## Verification commands

```
git diff --check
cargo fmt --all -- --check
cargo clippy --workspace --all-targets
cargo check --workspace
cargo test --workspace
pnpm --filter @local-brain/desktop sidecar
pnpm --filter @local-brain/desktop build
pnpm check   # only if a TS/docs-generated surface changes (none expected)
```
