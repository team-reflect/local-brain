# Large refactor — review notes

Decisions worth preserving, especially the deliberate *non*-changes. See
[plan.md](plan.md) and [status.md](status.md).

## Why some surveyed findings were rejected or rescoped

A multi-agent survey proposed more than was implemented. Each was re-checked against the
source; these were declined on purpose:

- **Generic Kysely `listActive` / `getById` helpers.** A runtime table parameter cannot
  satisfy Kysely's per-table `ReferenceExpression` typing under this repo's strict
  tsconfig (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …) without casting
  to `any`. The explicit per-domain queries are more type-safe and equally legible. The
  safe, real win — the shared *type* aliases — was taken (`db/records.ts`).
- **Collapsing `relations/getters.ts` (~28 join queries) into a raw-SQL helper.** Reads
  go through Kysely's `CamelCasePlugin`; a `sql`-template helper would need snake_case
  identifiers and would drop result typing — a worse trade than the duplication. The
  shared part (`asLinks`) is already extracted. Left explicit.
- **Renaming `projects.completed_on` → `completed_at`.** These differ by intent (a
  project completion *date* vs a task completion *timestamp*). Renaming a column on
  durable user data is a migration/data-safety risk not justified by a naming nit.
- **Adding `updated_at` to `updateEvidenceRef`.** Verified false positive: `evidence_refs`
  has only `created_at`, by design (a wrong citation is hard-deleted, not versioned).
- **Exporting `extractJsonObject`.** Already exported from `ai/index.ts` and the core
  barrel — no change needed.
- **A typed IPC command-name registry.** Modest value for the churn; `call()` already
  validates every response with a zod schema. Noted as a future option.
- **A new `brain-common` Rust crate** moving ULID/text/chunk out of the CLI. Larger than
  its value; the only concrete *in-Rust* duplication (db path, schema version) was folded
  into the existing shared `brain-schema` crate instead. The CLI↔TypeScript ULID/FTS
  duplication is cross-language and intentional (each runtime needs its own
  implementation); it is covered by behavioural parity, not a shared module.

## Behaviour-preservation notes

- **Extraction merge.** `applyExtraction` keeps identical write/suggestion/dedupe
  semantics and remains one `db_batch` transaction. Applier order is preserved exactly
  (people → orgs → projects → affiliations → tasks → source links → memories), since
  later steps depend on earlier `resolved` entries. The real-SQLite
  `db/extraction.test.mjs` golden test is the guardrail.
- **Source-link topology.** `SourceLinks` changed from named fields
  (`people`/`organizations`/…) to an entity-type-keyed record; this type is internal to
  the apply path (no external consumer), and the emitted join rows are unchanged.
- **Global search ranking.** `ftsHit` now calls `combineScore({ lexical, recency })`,
  which equals the previous inline `lexical*0.7 + recency*0.3` (no link boost), so result
  ordering is identical.
- **`quickSearch` LIKE escaping.** Now escapes `%`/`_`/`\` like `globalSearch` already
  did. For ordinary text queries the behaviour is identical; queries containing those
  literal characters now match more correctly and consistently.
- **Detail pages.** `DetailPage` reproduces the prior loading line, not-found
  `EmptyState`, and `max-w-2xl` container exactly; each page's fields/sections are
  unchanged. Verified by the existing `*.dom.test.tsx` suite.
- **Rust path/version helpers.** `$BRAIN_DB` → data-dir order preserved; the CLI keeps
  its `--db` flag override. CLI integration tests still pass.

## Historical docs left intact

`docs/build/manifest.md` and `docs/build/status.md` are append-only records of the
original implementation PR stack and describe each layer as it landed (e.g. "apply.ts +
apply-store.ts"). They are intentionally **not** rewritten here — editing them would
misrepresent what those PRs did. This `docs/large-refactor/` set is the record of the
post-stack structural changes.
