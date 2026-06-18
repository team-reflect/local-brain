# Large refactor — final report

Branch: `codex/local-brain-large-refactor` · base `origin/master` @ `3137d12`.
Eight commits · 58 files · +1993 / −1422.

A broad cleanup pass over the Local Brain monorepo. The architecture was already sound,
so the work was duplication removal, decomposition of two oversized files, and
consistency — not re-layering. No product behaviour or data/privacy semantics changed.

## Major refactor areas

1. **Extraction merge engine decomposed.** `extraction/apply.ts` went from a single
   495-line function to a ~107-line orchestrator over a shared `ApplyContext` (mutable
   insert buckets, summary, `resolved` map, and the confidence-gate / suggestion /
   dependency-gate / evidence helpers) plus focused per-entity appliers
   (`apply-entities.ts`, `apply-tasks.ts`, `apply-memories.ts`). Still one `db_batch`
   transaction with identical semantics.

2. **Single source of truth for the link topology.** `extraction/source-links.ts` now
   owns the document/interaction ↔ person/organization/project/task join-table mapping as
   typed insert/select closures. The extraction merge and ingestion both drive off it;
   ingestion's two near-identical link-statement builders collapsed into one.

3. **Desktop shared UI.** A `DetailPage` scaffold removes the loading / not-found /
   container boilerplate from all six detail pages; new `Loading` and `Alert` primitives
   replace inline copies; one exhaustive `routeForRecord(kind, id)` replaces two
   record→route mappers; the existing `sectionLabel` class constant is now used instead of
   re-inlined literals.

4. **Desktop query hooks reorganized.** The 482-line `lib/queries.ts` became a `queries/`
   folder split by area (records, corrections, ingest, search, chat, settings) behind a
   re-export barrel. Import paths are unchanged.

5. **Core consolidations.** Global search reuses the shared `ranking.ts` math; quick
   search reuses the shared LIKE builder; the six core domains share
   `NewRecord<T>` / `RecordPatch<T>` payload types.

6. **Rust dedup.** `brain_schema::resolve_db_path()` and `schema_version()` are now shared
   by the CLI and the Tauri shell (the `dirs` dependency moved with them); the CLI keeps
   only its `--db` override.

7. **Test-harness reuse.** A shared `test/bridge.ts` replaces three re-implemented IPC
   bridge spies.

See [plan.md](plan.md) for the full proposal, [status.md](status.md) for the commit
log, and [review-notes.md](review-notes.md) for decisions — especially the deliberate
non-changes (generic Kysely helpers, column renames, etc.).

## Verification results

All commands run from the repo root after the final commit. **All pass.**

| Command | Result |
| --- | --- |
| `git diff --check` | ✓ clean |
| `pnpm check` (typecheck + oxlint + vitest) | ✓ exit 0 |
| `pnpm --filter @local-brain/desktop build` | ✓ exit 0 (chunk-size warning only, pre-existing) |
| `pnpm --filter @local-brain/desktop sidecar` | ✓ exit 0 (CLI built + staged) |
| `cargo fmt --all -- --check` | ✓ exit 0 |
| `cargo check --workspace` | ✓ exit 0 |
| `cargo test --workspace` | ✓ exit 0 |

Test counts: core 119 → **125** (+6 `apply-context` unit tests), desktop **38**
unchanged, Rust workspace all green.

## Caveats

- **`cargo check --workspace` requires the sidecar to be staged first.** The desktop
  Tauri build script validates the `binaries/brain-<triple>` external binary exists, so
  `pnpm --filter @local-brain/desktop sidecar` (or `pnpm tauri`) must run before
  `cargo check`/`cargo test` on a clean checkout. This is pre-existing (the binary is
  git-ignored) and matches the documented verification order; it is not introduced by
  this refactor.
- **Bundled desktop app not launched.** Verification is automated checks, the Vite
  build, the staged sidecar, and the Rust workspace — not a manual run of the packaged
  `.app`. The dom/unit suites cover the refactored UI and core paths.
- **No behaviour or schema changes.** No migrations were added; no storage, file-read,
  backup, export, model-call, or deletion path was loosened.
