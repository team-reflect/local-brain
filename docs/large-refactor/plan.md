# Large refactor — plan

Branch: `codex/local-brain-large-refactor`, based on `origin/master` @ `3137d12`.

This document is the durable plan for a broad code-cleanup pass over Local Brain.
It is paired with `status.md` (running log) and `final-report.md` (outcome).

## Method

The codebase (~15k LOC) was surveyed both by hand and by a parallel multi-agent
architecture survey across nine subsystems (core domains, core db/ipc, extraction,
retrieval/reports, ai, desktop shared UI, desktop surfaces, Rust, tests/docs). Every
machine-suggested finding below was re-checked against the source before being
accepted, rejected, or rescoped. Rejected findings are recorded so the reasoning
survives.

## Current architecture observations

Local Brain is a Tauri desktop app plus a Rust `brain` CLI sidecar over one durable
SQLite database. The shape is already clean and layered:

- **`crates/brain-schema`** — the single source of truth for the SQLite schema and
  `open_and_migrate`. Both Rust binaries depend on it, so writer and reader can never
  skew on schema or SQLite version.
- **`packages/db`** — Kysely schema types + an `IpcDialect` that compiles reads to
  `{ sql, params }` and runs them over a Rust-owned connection. A `CamelCasePlugin`
  maps camelCase ↔ snake_case.
- **`packages/core`** — the platform-agnostic domain layer: typed IPC boundary
  (`ipc/`), read(Kysely)/write(compiled-to-Rust-transaction) split (`db/`), per-domain
  getters/setters (`domains/`), ingestion, extraction merge engine, retrieval/search,
  AI model boundary, reports, graph, backup, seed. Everything is re-exported from one
  barrel `index.ts`.
- **`apps/desktop`** — React + TanStack Query UI. `lib/queries.ts` is the only place
  components touch core; components read through hooks. A Reflect-style design system
  lives in small primitives (`Badge`, `DataList`, `PageHead`, …) and shared class
  strings in `lib/ui.ts`.
- **`apps/cli`** — a Rust CLI that opens the SQLite file directly and reads/writes the
  same schema.

The architecture is sound; the work is duplication removal, decomposition of two
oversized files, and consistency — **not** re-layering.

### Notable strengths (preserve)

- The IPC boundary (`call()` + zod validation) and the read/write split are crisp.
- Domains are small and consistent; `asLinks`, `DataList`, `Badge`, `combineScore` are
  already extracted.
- The Rust side already shares schema via `brain-schema`.

### Real problems found

1. **`extraction/apply.ts` (495 LOC)** is one function merging six entity types with
   repeated match-or-create / confidence-gate / dependency-gate / link blocks.
2. **Link-statement builders are duplicated** — `apply-store.ts:sourceLinkStatement`
   (6 branches) and `ingest.ts` (`documentLinkStatements` + `interactionLinkStatements`)
   independently encode the same join-table topology.
3. **Six desktop detail pages** repeat the same scaffold (loading → not-found →
   container → `PageHead` → fields → linked sections).
4. **`lib/queries.ts` (482 LOC)** mixes ~70 hooks across every domain in one file.
5. **Scattered styling** — `sectionLabel` / `metaText` exist in `lib/ui.ts` but several
   components re-inline the same class strings; there is no `Loading` or `Alert`
   primitive despite repeated use; record→route mapping is duplicated in two components.
6. **Retrieval/AI micro-duplication** — `globalSearch` re-implements the `combineScore`
   formula inline; `quickSearch` hand-rolls a LIKE pattern instead of `toLikePattern`;
   `extractJsonObject` is a reusable, tested utility trapped as private.
7. **Setter type aliases** — every domain repeats
   `Omit<Insertable<T>, 'id'|'createdAt'|'updatedAt'>` / `Omit<Updateable<T>, …>`.
8. **Rust duplication** — `resolve_db_path` and `PRAGMA user_version` reads are
   duplicated between the CLI and the Tauri shell.
9. **Test boilerplate** — the capturing-bridge spy and "bridge returning X" helpers are
   re-implemented in many `*.test.ts` files.

## Proposed refactor areas

### A. Extraction merge engine (`packages/core/src/extraction/`)
Decompose `apply.ts` into a small orchestrator plus focused per-entity appliers over a
shared mutable `ApplyContext` (insert buckets, `resolved` map, summary, candidates,
chunk map, options, and the `accepts`/`pushSuggestion`/`unresolved-deps` helpers).
Target: `apply.ts` < 120 LOC orchestration; each applier a legible ~40–90 LOC module.

### B. Link-statement topology (one source of truth)
Introduce `domains/relations/link-tables.ts` holding the record↔entity join-table map
as typed closures, and route both ingestion and the extraction source-linking through
it. Removes the third independent copy of the join topology.

### C. Desktop shared UI
- `components/loading.tsx`, `components/alert.tsx` primitives.
- `routing/route.ts` → `routeForRecord(kind, id)` typed mapper, used by `linked-records`
  and `citation-list`.
- `components/detail-page.tsx` scaffold; refactor all six detail pages onto it.
- Use the existing `sectionLabel` / `metaText` constants instead of inline duplicates.

### D. Desktop query hooks
Split `lib/queries.ts` into a `lib/queries/` folder by domain with an `index.ts`
re-export. Import paths (`../lib/queries`) are unchanged, so this is pure organization.

### E. Retrieval / AI consolidation
`globalSearch` uses `combineScore`; `quickSearch` uses `toLikePattern`; name the
`0.6` name-hit base score; export `extractJsonObject`.

### F. Domain setter types
Add `db/records.ts` with `NewRecord<T>` / `RecordPatch<T>` and apply across the six
core domains. Pure type-level change.

### G. Rust shared helpers
Add `brain_schema::default_db_path()` and `brain_schema::schema_version()`; have the
CLI and the Tauri shell call them.

### H. Test harness reuse
Add `packages/core/src/test/bridge.ts` with a capturing-bridge factory and a
"bridge returning value" helper; migrate the unit tests onto it.

### Considered and deliberately **not** done (with reasons)
- **Generic Kysely CRUD `listActive`/`getById` helpers** — a runtime table parameter
  cannot satisfy Kysely's per-table `ReferenceExpression` typing under this repo's
  strict tsconfig without casting to `any`. The explicit per-domain queries are more
  type-safe and just as legible. The cheap, safe slice (shared *type* aliases) is taken
  in area F instead.
- **Collapsing `relations/getters.ts` into a raw-SQL helper** — the `CamelCasePlugin`
  means a `sql`-template helper would require snake_case identifiers, breaking the
  camelCase convention used everywhere else and dropping result typing. The shared part
  (`asLinks`) is already extracted; the rest stays explicit.
- **Renaming `projects.completed_on` → `completed_at`** — these are distinct by intent
  (a project completion *date* vs a task completion *timestamp*) and renaming a column
  on durable user data is a migration/data-safety risk not justified by a naming nit.
- **Adding `updated_at` to `updateEvidenceRef`** — verified: `evidence_refs` has no
  `updated_at` column (only `created_at`), so the current setter is correct. (Survey
  false positive.)
- **A typed IPC command-name registry** — modest value for the churn; the `call()`
  boundary already validates every response. Noted as a future option.
- **A new `brain-common` Rust crate moving ULID/text/chunk** — larger than the value;
  the only concrete in-Rust duplication (db path, schema version) is folded into the
  existing shared `brain-schema` crate instead.

## Risks

- **Extraction merge behavior** is the highest-stakes area: it must remain a single Rust
  transaction with identical write/suggestion/dedupe semantics. Mitigated by the
  existing `db/extraction.test.mjs` real-SQLite integration test plus contract tests.
- **Detail-page scaffold** must preserve each page's exact fields, sections, and
  not-found copy. Mitigated by the existing `*.dom.test.tsx` tests.
- **Rust path/version helpers** must keep identical resolution order
  (`$BRAIN_DB` → data dir). Mitigated by CLI integration tests.
- Broad changes risk lint/type regressions under the strict tsconfig; mitigated by
  running `pnpm check` and `cargo check` after each area.

## Acceptance criteria

- No change to product behavior or data/privacy semantics (storage, file reads, backup,
  export, model calls, deletion all behave as before).
- `apply.ts` and `lib/queries.ts` are decomposed into focused modules; no single new
  module reintroduces the old size.
- Join-table topology has one source of truth.
- All six detail pages render through the shared scaffold with unchanged output.
- Net reduction in duplicated code; no new `any`, no loosened tsconfig.
- All verification commands below pass (or carry a precise, justified caveat).

## Verification plan

Run after each area and once at the end:

- `git diff --check`
- `pnpm check` (typecheck + oxlint + vitest across all packages)
- `pnpm --filter @local-brain/desktop build`
- `pnpm --filter @local-brain/desktop sidecar`
- `cargo fmt --all -- --check`
- `cargo check --workspace`
- `cargo test --workspace`

Baseline (pre-refactor) confirmed green: `pnpm check` ✓ and `cargo check --workspace` ✓.
