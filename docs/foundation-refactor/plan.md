# Foundation Refactor — Plan

Branch: `codex/local-brain-foundation-refactor` · base `origin/master` @ `9cd2d84`.

## Context

Local Brain is a young but already-once-refactored monorepo (see
`docs/large-refactor/`). The architecture is fundamentally sound: SQLite is the
single source of truth, the Kysely schema is generated from the Rust migrations
with a drift check, the desktop reads through a typed IPC bridge, and the `brain`
CLI is a self-contained Rust sidecar.

Three independent audits (Rust CLI, desktop frontend, TS core) converged on one
highest-leverage structural gap that is **not** cosmetic:

> There is **no shared validation/normalization layer at the record-write
> boundary**, and the create/update/archive scaffolding is **duplicated across
> six TypeScript domains and five Rust `add` commands**. Records are written
> exactly as handed in — untrimmed names, mixed-case emails, un-normalized
> domains, and empty documents/interactions are all accepted.

This matters for a product where *agents are the primary writers through two
independent paths* (the desktop core and the Rust CLI). Inconsistent
normalization directly degrades duplicate detection (`extraction/match.ts`
matches on `normalizeEmail`/`normalizeDomain`/`normalizeName`, but nothing
normalizes those fields on the way in) and data quality.

The architecture conventions doc already calls for a per-domain `validators.ts`
that "normalizes email/domain/name at insertion"; it simply was never built.

## Goal

Introduce a real, shared **domain write layer** and apply it consistently across
both write paths so a record is clean regardless of whether an agent wrote it
through the desktop core or the `brain` CLI.

## Refactor slices

1. **Core normalization module** — `packages/core/src/text/normalize.ts`.
   Consolidate the field normalizers (`normalizeName`, `normalizeEmail`,
   `normalizeDomain`, currently buried in `extraction/match.ts`) and add the two
   storage-side primitives that were missing: `squish` (collapse internal
   whitespace, preserve case — for display names) and `trimToNull`.
   `extraction/match.ts` re-exports them so matching keeps its existing imports.

2. **Validation primitive** — `packages/core/src/validation.ts`. A typed
   `ValidationError` (`kind: 'validation'`) plus `requireText`. Adds
   `'validation'` to the shared `AppErrorKind` union.

3. **Per-domain validators** — `validators.ts` for people, organizations,
   projects, tasks, documents, interactions. Each normalizes its string fields
   and enforces preconditions the DB cannot (non-empty `fullName`/name/title; a
   document or interaction must carry a title or body). Pure functions returning
   a cleaned payload; trivially unit-testable.

4. **Shared mutation helpers** — `insertRecord` / `updateRecord` /
   `archiveRecord` in `packages/core/src/db/records.ts` (today types-only). These
   collapse the identical id-gen + `updatedAt` + `archivedAt` plumbing repeated
   in all six domains into one tested place.

5. **Rewire the six setters** to `validate → helper`, so the canonical create and
   update paths are always guarded and normalized. Bespoke transactional paths
   (`createInteraction` batch + participants, `completeTask`, `completeProject`)
   keep their logic but adopt the validator and the shared `archiveRecord`.

6. **Rust CLI parity** — a small `normalize` module in `apps/cli` mirroring the TS
   storage normalizers, applied in `commands/add.rs` so the CLI write path trims
   names, lowercases emails, and rejects empty documents/interactions exactly
   like core. Plus a correctness fix: parameterize the graph self-exclusion
   instead of string-interpolating the id.

7. **Docs alignment** — resolve the `domains/` vs documented `actions/` drift by
   updating `architecture-conventions.md` to the real layout and documenting the
   new write layer. Refactor reports under `docs/foundation-refactor/`.

## Out of scope (deliberate)

- Unifying the Rust CLI and TS core into one implementation. The TS-owns-policy /
  Rust-owns-native split is a documented, deliberate design choice; collapsing it
  would require embedding a JS runtime in the CLI or rewriting core in Rust. We
  instead make the *behavior* (normalization/validation) consistent across both.
- Desktop query-invalidation tuning. Real but behavioral and lower-leverage; it
  belongs in its own focused PR with its own test changes.
- Renaming `domains/` → `actions/`. High churn, low value; the doc is corrected
  instead.

## Acceptance criteria

- A new `text/normalize` + `validation` + per-domain `validators` layer exists and
  is unit-tested.
- All six core domains create/update through the validator + shared helpers; no
  domain hand-writes the id/timestamp/archive plumbing anymore.
- The `brain` CLI normalizes and validates writes consistently with core, with
  CLI tests covering rejection of an empty document/interaction and email/name
  normalization.
- Public behavior preserved for every existing test; new behavior (rejecting
  empty/blank required fields) is covered by new tests.
- Docs reflect the implemented layout.

## Risks & mitigations

- **Kysely dynamic-table typing** for the generic mutation helpers → use the
  localized `as never` value cast (no `any`, satisfies `no-explicit-any`); verify
  with `pnpm typecheck` early.
- **Behavior drift breaking existing tests** → audited every `create*` caller
  (seed, integration/actions/extraction/corrections/retrieval tests, desktop
  hooks). All use clean inputs and titled records, so trim/normalize is a no-op
  for them; the only new failures are intentional (empty required fields).
- **Two write paths drifting again** → the CLI normalize module is documented as
  the Rust twin of `text/normalize.ts`, mirroring the existing FTS/LIKE twin
  convention, and both are covered by tests.

## Verification plan

- `git diff --check`
- `pnpm check` (typecheck + oxlint + vitest, incl. the schema drift check)
- `pnpm --filter @local-brain/desktop build`
- `pnpm --filter @local-brain/desktop sidecar` (stages the CLI binary)
- `cargo fmt --all -- --check`
- `cargo check --workspace`
- `cargo test --workspace`
- New focused tests: `text/normalize.test.ts`, per-domain `validators.test.ts`,
  CLI validation tests in `apps/cli/tests/cli.rs`.
