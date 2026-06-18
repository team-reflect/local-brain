# Large refactor — status

Branch: `codex/local-brain-large-refactor` · base `origin/master` @ `3137d12`.

Running log of the refactor pass. See [plan.md](plan.md) for scope/rationale and
[final-report.md](final-report.md) for the outcome and verification.

## State: complete

All planned areas landed as eight coherent commits. Every verification command passes.

## Commits (oldest → newest)

1. `6ea1f13` **core/retrieval** — `globalSearch` reuses `lexicalScore` + `combineScore`
   from `ranking.ts`; named `NAME_HIT_SCORE`; `quickSearch` reuses `toLikePattern`.
2. `81a418a` **core/domains** — shared `NewRecord<T>` / `RecordPatch<T>` (`db/records.ts`)
   replace the per-domain `Omit<…>` payload boilerplate in 7 domains.
3. `d8d4339` **core/extraction+ingest** — `extraction/source-links.ts` is the single
   source of truth for the source-record ↔ entity join topology; ingestion's two
   link-statement builders collapse into one.
4. `e9fe186` **core/extraction** — `apply.ts` decomposed 495 → 107 LOC: shared
   `ApplyContext` + per-entity appliers (`apply-entities`, `apply-tasks`,
   `apply-memories`); adds `apply-context` unit tests.
5. `00bd347` **desktop/ui** — `DetailPage` scaffold for all six detail pages;
   `Loading` + `Alert` primitives; one typed `routeForRecord`; consistent `sectionLabel`.
6. `71ac1ce` **desktop/queries** — `lib/queries.ts` (482 LOC) split into a `queries/`
   folder by area behind a re-export barrel (import paths unchanged).
7. `97c0017` **rust** — `brain_schema::resolve_db_path()` + `schema_version()` shared by
   the CLI and the Tauri shell; `dirs` moves to `brain-schema`.
8. `40a27e8` **test/core** — shared IPC bridge-spy helpers (`test/bridge.ts`); three test
   files migrated.

## Test counts

- `@local-brain/core`: 119 → **125** (added `apply-context.test.ts`, 6 cases).
- `@local-brain/desktop`: **38** (unchanged; all dom tests still green).
- Rust workspace: all tests green (CLI, desktop shell, brain-schema).

## Deferred (with reasons) — see plan.md

Generic Kysely CRUD helpers and a raw-SQL `relations/getters.ts` collapse (strict-typing
/ CamelCasePlugin hazards), `projects.completed_on` rename (data-safety), an
`updateEvidenceRef` `updated_at` (no such column — survey false positive), a typed IPC
command registry, and a new `brain-common` crate (folded minimal helpers into the
existing `brain-schema` instead).
