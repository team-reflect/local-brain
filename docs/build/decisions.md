# Build Decisions & Open Questions

Decisions made by the build supervisor and open questions that need Alex. Each entry has
an ID, status, and the rationale or the question. Resolved questions stay here for the
record.

## Needs Alex

None at this checkpoint.

## Resolved

### D1 — Rust toolchain not installed in build environment
- **Status:** RESOLVED locally on 2026-06-17.
- **Impact:** Initial Plan 00/01/02a authoring could not run `cargo check`,
  `cargo test`, or `cargo fmt` because `cargo`, `rustc`, and `rustup` were not
  on PATH.
- **Resolution:** Installed the Homebrew Rust toolchain (`cargo 1.96.0`,
  `rustc 1.96.0`) and re-ran the Rust gates locally. The foundation Tauri shell
  needed a placeholder icon set for `tauri::generate_context!()`; after adding
  it, `cargo check --workspace` and `cargo test --workspace` pass.

## Decisions (no action needed)

### DEC-1 — Stacked PRs via explicit base branches
- `gh stack` is unavailable. Using ordinary PRs, each based on the branch below it in the
  stack, with the relationship recorded in `manifest.md`. Rebase + retarget to `master`
  as lower layers merge.

### DEC-2 — Plan 02 split into 02a/02b/02c/02d
- Schema crate (Rust) / Kysely codegen (TS) / Rust IPC bridge / core actions + seed are
  separated for reviewability, per the supervisor brief's allowance to split the DB
  layer. `02c` (the Rust `db_query`/`db_execute`/`db_batch` bridge, cargo-verified) was
  split from `02d` (the TypeScript domain layer + seed, `pnpm check`-verified) so each
  PR is a single language/concern. Subsequent layers' bases shift up by one
  (`03` now bases on `…-02d-core-db`).

### DEC-3 — Package + binary names
- Default to `@local-brain/*` packages and `brain` CLI (per Plan 01 open question) until
  Alex renames.

### DEC-5 — Plan 03 split into 03a/03b
- The desktop UI is the largest layer. `03a` ships the shell skeleton that the plan's
  test section emphasizes (typed routing + serialization, central keymap with a
  duplicate-binding guard) plus the data-backed core surfaces (Today, Tasks, Network→
  People, Projects, and the five detail pages), all verified via `pnpm check` + Vite
  build. `03b` carries the heavier, partly-dependent pieces (Graph, the Ask shell which
  needs Plan 06 retrieval, full Settings, organization browsing, richer linked-record
  detail sections, and a cmdk palette). Splitting keeps 03a reviewable and fully
  verifiable now without shipping half-built surfaces.

### DEC-6 — node:sqlite over better-sqlite3 for TS-side SQLite
- The 02b codegen and 02d integration test apply the real migrations using Node's
  built-in `node:sqlite` instead of `better-sqlite3` + `kysely-codegen`. Rationale:
  no native build (fragile on Node 26 with no prebuilds) and no new dependencies. The
  generated Kysely types and the round-trip tests both rely on it. `node:sqlite` is
  untyped today, so the codegen + integration test live in `.mjs` files outside the
  typechecked `src` surface.

### DEC-10 — Plan 04 split into 04a/04b/04c
- Ingestion spans three concerns/languages: the TS ingestion engine (chunking, hashing,
  transactional record+chunk+link writes, dedupe), the Rust safe-file-read primitives
  (path-traversal guards, size caps, hashing, folder enumeration), and the ingestion UI
  (paste/import flows, folder import, Add actions). Split per the brief's allowance so each
  PR is one language/concern and independently verifiable: **04a** by `pnpm check`, **04b**
  by `cargo`, **04c** by `pnpm check` + Vite build. Downstream bases shift to `…-04c-…`.
- DEC: content hashing is **SHA-256** on both sides (TS Web Crypto in 04a, Rust `sha2` in
  04b) so a pasted note and an imported file with identical content produce the same
  `content_hash` and dedupe against each other.

### DEC-12 — Plan 05 split into 05a/05b; model-backed extraction deferred to Plan 06
- **Sequencing.** Plan 05 ("memory extraction & linking") is mostly deterministic, but its
  one model-dependent step — step 3, *build model extraction for documents and
  interactions* — depends on the BYOK model boundary that Plan 06 introduces (step 11,
  model-boundary checks; keys in keychain; "external calls enabled" setting). Faking
  extraction with brittle heuristics to satisfy the headline was explicitly out of bounds.
- **Decision.** Build the deterministic engine *around* an explicit, typed model seam now,
  and defer the model-backed extractor to Plan 06:
  - **05a (this PR):** the extraction **output contract** (zod schemas + graph validation),
    deterministic **pre-processing** (`buildExtractionContext`: chunks, date/email/
    participant hints, dedupe candidates), deterministic **merge/upsert matching**
    (people/orgs/projects by key + normalized name), and the transactional **apply**
    pipeline (`applyExtraction`: resolve refs → existing-or-new rows, link to source,
    create memories + `memory_links` + `evidence_refs`, confidence-gated suggestions, dup
    avoidance) — all in `packages/core`, `pnpm check`-verifiable with unit + real-SQLite
    **golden** tests over hand-authored results (the model's output contract). The
    `Extractor` seam is wired into the ingest queue but **no extractor is registered by
    default**, so `runExtraction` is a safe no-op until a model adapter exists.
  - **05b:** correction flows (step 8 — unlink/edit/archive, fix citations) + relationship
    intelligence (step 9 — last-interaction/reconnect/strength/important-dates recompute),
    which are deterministic but UI/setter-heavy and read more cleanly as their own layer.
  - **Plan 06:** registers the real BYOK model-backed `Extractor` (and enrichment of matched
    records) through the same checked model boundary, plus golden tests over live output.
- **Why this is honest.** The deterministic half — which is the part that writes to the
  canonical SQLite store — is fully built and tested. The model is the only missing piece,
  and the boundary it must satisfy is a typed, validated contract, not a stub pretending to
  be a model. Downstream bases shift to `…-05a-extraction-engine` then `…-05b-corrections`.

### DEC-13 — Relationship intelligence is derived; strength is recompute-owned; important dates deferred
- **What it derives (Plan 05b step 9).** `recomputeRelationshipIntelligence(personId)` is a
  deterministic projection over a person's interactions and shared tasks — no model. It owns
  three `people` columns:
  - `last_interaction_at` = the most recent dated, non-archived interaction (null if none).
  - `next_reconnect_at` = `last_interaction_at + reconnect_interval_days` (null if either is
    missing). `reconnect_interval_days` itself is a **user-set cadence input** and is never
    overwritten.
  - `relationship_strength` = a transparent 1–5 score (frequency + recency + shared open
    tasks; see `strength.ts`). It is written **only when there is a signal** (≥1 recent
    interaction or open task), so a manually set strength survives for a person we have no
    data on — recompute never clobbers a value it cannot derive.
- **When it runs.** Incrementally after a relevant interaction is created
  (`createInteraction`, `ingestInteraction`, and `applyExtraction` on an interaction source
  refresh the affected participants), and in bulk via `recomputeAllRelationships()` (used on
  first-run seeding and as a manual refresh). Reconnect suggestions are then a fast read of
  the derived `next_reconnect_at` column (`listReconnectSuggestions`), no scoring at read time.
- **Important dates are deferred.** The schema has an `important_dates_json` column but no
  field (birthday, anniversary, calendar event) that supplies dates to derive — calendar
  sync is explicitly out of Plan 05's scope. So recompute **does not touch**
  `important_dates_json`; it stays user-owned until a data source exists (a later plan).
  Plan 05 step 9 allows this ("important dates *where supported by existing schema/data*").
- **Why honest.** Everything written is a pure summary of data the user already has; nothing
  is invented. The one place a value would otherwise be fabricated (important dates, or a
  strength for a contact with no data) is deliberately left alone.

### DEC-11 — Ingestion file selection via path field, not a native picker (04c)
- The `AddRecordDialog` takes a typed file/folder **path** rather than opening the native
  OS picker. Rationale: the native picker needs the Tauri dialog plugin (Rust plugin +
  capability + JS package) and only works inside the running app, which would make the
  dialog un-renderable in jsdom tests and the dev/browser context. A path field exercises
  the 04b Rust readers end-to-end, keeps the build hermetic and the UI render-testable, and
  the native picker is a thin follow-up (it only needs to produce the same path string).

### DEC-7 — 03b kept as one branch; palette stays hand-rolled (no cmdk)
- 03b (Graph, Ask, full Settings, org browsing, richer detail, palette record search,
  render tests) is additive UI + read-only getters + tests with no Rust changes, so it
  ships as a single reviewable branch rather than being split further.
- The plan allowed a `cmdk`-based palette "if the dependency is appropriate." We instead
  extended the existing hand-rolled palette with live record search (people/orgs/projects/
  tasks/documents/interactions via a simple `quickSearch` LIKE getter) and arrow-key
  navigation. Rationale: it avoids pulling in `cmdk` + its Radix dependency tree and the
  React 19 peer surface, already matches the warm-paper design system, and keeps the build
  hermetic. The command registry remains the single source of truth, so a `cmdk` swap later
  is a view-only change. Real ranked/full-text search (FTS5/embeddings) is still Plan 06;
  `quickSearch` is explicitly a navigational quick-open, not retrieval.

### DEC-8 — Ask persists a labeled Plan-06 placeholder answer
- The Ask shell is real (conversations + messages persist via the `chat_conversations` /
  `chat_messages` tables), but retrieval/answer generation is Plan 06. Sending a message
  persists the user turn and a clearly-labeled placeholder assistant turn ("retrieval lands
  in Plan 06") so a conversation reads as a coherent thread and the list/threading logic is
  exercised now. Plan 06 replaces the placeholder with grounded, cited answers.

### DEC-9 — Component render tests via jsdom + Testing Library (per-file env)
- Added `jsdom` + `@testing-library/react`/`dom` as desktop dev deps and a desktop
  `vitest.config.ts` (`globals: true`, default `environment: 'node'`). DOM render tests opt
  in per file with a `// @vitest-environment jsdom` docblock, so the fast node-env unit
  tests (routing, command keymap, graph layout) keep running without a DOM. A shared
  `src/test/utils.tsx` installs an in-memory IPC bridge (canned/per-SQL `db_query` rows) and
  a query+router provider wrapper.

### DEC-4 — Sequential build (no parallel worker sessions)
- This session drives the stack sequentially and commits from one working tree.
  Read-only research may fan out within a layer, but there is no parallel-session
  orchestration of commits. Recorded per the brief's failure-behavior contract.
