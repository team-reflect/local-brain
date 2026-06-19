# Rust Quality Refactor — Final Report

## Summary

A focused, behavior-preserving quality pass over the Local Brain Rust workspace.
The headline change is decomposing the CLI's 3090-line `commands/add.rs` into a
cohesive `add/` module tree (one entity per file, tests moved alongside), plus
removing duplicated SQL/string plumbing, clearing the one clippy warning, and
tightening module docs. No CLI flags, JSON output, exit codes, IPC contracts, or
SQL/migrations changed.

## What changed

### CLI: `commands/add.rs` → `commands/add/` (the main work)

`add.rs` was a single 3090-line file mixing pure string helpers, dedupe SQL,
external-identity upserts, six entity writers, and ~30 tests. It is now:

| Module | Responsibility |
| --- | --- |
| `add/mod.rs` | module docs, public re-exports, shared `report_record` |
| `add/text.rs` | pure string normalization (`normalize_*`, `valid_email`, `safe_filename`) |
| `add/identity.rs` | sources, content-hash dedupe, `external_identities` reads/writes |
| `add/links.rs` | `content_chunks` + typed-link join writers |
| `add/person.rs` | person writes, dedupe, enrichment, handles (+ 13 tests) |
| `add/person_import.rs` | untrusted-name import guardrails (+ 8 tests) |
| `add/asset.rs` | content-addressed asset import |
| `add/document.rs` | document ingest |
| `add/interaction.rs` | interaction ingest + participants (+ 4 tests) |
| `add/task.rs` | task creation + link wiring |
| `add/memory.rs` | `brain remember` |

Each file is now well under ~600 lines and reads top-to-bottom as one concern.
Intra-`add` helpers use `pub(super)` visibility; only the public arg structs and
entry functions are re-exported from `add/mod.rs`, so `main.rs` is unchanged
apart from the boxed subcommand (below).

### De-duplicated plumbing

- **One SHA-256 hex primitive.** `text::sha256_hex(&[u8])` now backs both
  `text::content_hash` (text dedupe) and asset hashing. Previously the asset
  path had its own `hash_bytes` and `content_hash` open-coded the hex loop with a
  per-byte `format!` allocation; the new encoder writes hex directly.
- **One link-kind label.** `LinkKind::as_str()` replaces three open-coded
  `match link.kind { … }` blocks (the old `record_type` fn, `remember`, and asset
  links), so a link is labeled identically everywhere it is stored.
- **One interaction enrichment path.** The two near-identical duplicate-path
  transaction blocks in `add_interaction` (external-identity match and
  content-hash match) now funnel through a single `enrich_existing_interaction`
  helper.

### Clippy

`clippy::large_enum_variant` on the CLI `Command` enum is resolved by boxing the
`Add { what: Box<AddCommand> }` payload (the `add` subcommands carry by far the
largest argument structs). `cargo clippy --workspace --all-targets` is now
**clean with zero warnings**.

### Docs

Added the missing module docs for `cli/src/error.rs` and the desktop
`src-tauri/src/lib.rs` entry point, and gave every new `add/*` module a doc
comment describing its boundary.

## Scope decisions

- **Desktop crate**: already cohesive and, once the sidecar is staged, already
  clippy-clean — so this pass kept it to a crate-level doc comment rather than a
  speculative refactor. See follow-ups.
- **brain-schema**: already high quality (15 tests, thorough docs); left as-is.
- No behavior changes were intended or made; the existing unit + integration
  suites are the safety net and all pass unchanged.

## Verification

All commands run from the worktree root on `aarch64-apple-darwin`:

| Command | Result |
| --- | --- |
| `git diff --check` | clean |
| `cargo fmt --all -- --check` | clean |
| `cargo clippy --workspace --all-targets` | clean (0 warnings) |
| `cargo check --workspace` | clean |
| `cargo test --workspace` | 130 passed, 0 failed, 1 ignored (pre-existing) |
| `pnpm --filter @local-brain/desktop sidecar` | built + staged |
| `pnpm --filter @local-brain/desktop build` | built (pre-existing chunk-size advisory only) |

`pnpm check` was not required: the change is Rust + `docs/` only — no
TypeScript, `schema.gen.ts`, or generated docs surface was touched.

Note: the desktop crate's `cargo`/clippy build requires the staged `brain`
sidecar binary first (`pnpm --filter @local-brain/desktop sidecar`); this is a
pre-existing repo requirement, not introduced here.

## Test accounting

The 30 CLI unit tests after the split match the originals exactly (13 person +
8 person-import + 4 interaction + 4 text + 1 id), so no test was dropped in the
move. The interaction-enrichment dedup is covered by the existing
`add_interaction_dedupes_by_external_id_and_enriches_provenance` integration
test and `allow_duplicate_interaction_does_not_steal_external_identity` unit
test.

## Recommended follow-ups (not done this pass)

- The desktop `brains.rs` (1752 lines) and `embed/mod.rs` (517 lines) are the
  next-largest single files; a similar cohesion pass could split brain-registry
  persistence from the Tauri command handlers. Deferred to keep this PR's diff
  reviewable and Rust-CLI-focused.
- Consider promoting `text::sha256_hex`/normalization helpers into a shared
  location if the desktop crate ever needs the same byte-compatible hashing
  (currently desktop hashes via `sha2` directly in `embed`).

## Repo state

- Branch: `codex/local-brain-rust-quality-refactor`
- Base: `master` @ a05e6ab
- PR URL: https://github.com/maccman/local-brain/pull/50
- Final head SHA: 8a0ab44c634fb93c111033c8355e09e2bdc1b286
