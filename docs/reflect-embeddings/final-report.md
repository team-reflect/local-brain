# Reflect Embeddings → Local Brain: Final Report

Ported Reflect Open's local semantic-search system into Local Brain, adapted to Local
Brain's durable SQLite product model, IPC contract, and settings/diagnostics UX. Reflect
Next's WebGPU/Transformers.js path was deliberately rejected as wrong for a Tauri desktop
app and contrary to `docs/plans/libraries.md` (which commits to `fastembed` + `sqlite-vec`).

## What shipped

### Storage (Rust, `crates/brain-schema`)
- `sqlite-vec` registered process-globally via `register_sqlite_vec()` before any
  open/migrate, so the desktop **and** the CLI share one registration and migration 0003
  runs everywhere.
- Migration `0003_embeddings.sql`: `chunk_embeddings(id INTEGER PK, chunk_id, content_hash,
  model_id, …, UNIQUE(chunk_id, model_id))` + `chunk_vectors USING vec0(embedding
  float[384] distance_metric=cosine)`, keyed `chunk_vectors.rowid == chunk_embeddings.id`.
  `LATEST_SCHEMA_VERSION` → 3.
- Vectors attach to the durable `content_chunks` table (Local Brain's chunk unit), not
  Reflect's note paths. App writes transactionally project documents, interactions,
  memories, and profile-bearing person/organization updates; CLI import/enrichment also
  projects its supported entity text (including organization profiles, transcripts, AI
  notes, and facts). No cascade FK: the embedding pipeline owns the vector projection
  lifecycle.

### Embedding runtime (Rust, `apps/desktop/src-tauri/src/embed/`)
- `fastembed` (`all-MiniLM-L6-v2`, 384-dim) behind a `Runtime` state machine
  (uninitialized / loading+progress / ready / failed); the model downloads on demand into
  app data with byte-level progress via `hf-hub`.
- Commands: `embed_status`, `embed_ensure`, `embed_texts`, and the transactional writers
  `embed_apply` / `embed_delete` / `embed_clear` (the text↔int rowid coupling `db_batch`
  can't express). Each writer requires the expected database path + connection generation
  and validates it under the active-connection lock before committing.
- Progress is **polled** (`embed_status`), not event-pushed: the `IpcBridge` only exposes
  `invoke`, and the app uses no Tauri events. This is the Local-Brain-shaped simplification
  of Reflect's `subscribeEmbedStatus`.

### Core (TypeScript, `packages/core/src/embeddings/`)
- `model.ts` (constants + `EmbedStatus` zod union), `commands.ts` (typed IPC wrappers),
  `semantic.ts` (vec0 KNN via a CTE + RRF fusion), `pipeline.ts` (hash-skip incremental
  backfill / clear / prune over `content_chunks`), `status.ts` (`getEmbeddingsStatus`,
  enable toggle).
- `retrieve()` provides chunk-oriented semantic/hybrid search and blends lexical/vector
  ranks with RRF (K=60, cosine distance ≤ 0.7). `searchRecordCandidates()` is a sibling
  path for Chat: it shares the joins, filters, and semantic primitive, adds direct typed
  fields, collapses chunks to records, and performs record-level RRF. It does not compose
  or rerun `retrieve()`.
- vec0 selects global neighbors before typed joins and filters. Record-oriented calls
  therefore overfetch and double K to a bounded ceiling until enough unique filtered
  records are found. This mitigates filtered/source-concentrated pools but intentionally
  does not claim exhaustive filtered KNN recall.
- Semantic rows must match both the current model id and the owning chunk's current hash.
  Changed vectors become ineligible immediately; incremental backfill replaces them and
  prunes removed-chunk orphans. Any runtime failure degrades to lexical search.

### Desktop UX (`apps/desktop`)
- `EmbeddingsSync` headless coordinator loads the model, reacts to successful in-app
  mutations, and drains pending chunks. A cheap 60-second background status poll catches
  CLI/external writes; successful passes use a one-second cooldown, and all automatic/
  manual passes share one exclusive coordinator.
- Settings → **Semantic search**: enable/disable, model download progress bar, runtime +
  index status (indexed/total, pending), "Backfill now", and "Rebuild index".
- Diagnostics now reports the real semantic state instead of a hardcoded "off".

### Tooling
- The schema codegen and the JS test harness strip `CREATE VIRTUAL TABLE … USING vec0`
  before replaying migrations into Node's built-in SQLite (which lacks the extension) —
  like FTS5, vec0 tables are raw-SQL-only and excluded from the typed builder. `schema.gen.ts`
  regenerated with `chunkEmbeddings`.

### Grounded Chat integration (current follow-up)
- Each turn receives bounded planning metadata, then uses record-level search/browse,
  structured task/project lists, and batched detail reads with per-record and total text
  budgets. Explicitly requested chunks are allocated first.
- Tool calls/results remain in durable local AI SDK message JSON for an inspectable trace,
  but prior raw results are replaced with elision markers before a later provider request.
  They are not `evidence_refs`.
- Search results carry stable record/chunk refs and an existing navigation target. Derived
  sources can open an unambiguous parent (for example transcript → interaction); unsupported
  or hallucinated citations remain inert.
- Tool rounds are bounded and the last allowed model step is synthesis-only, with a
  deterministic no-answer fallback.
- The transport captures the active database path + connection generation. Reads are
  rejected on a switch, and conversation persistence, generated titles, approvals, Chat
  writes, and native embedding mutations remain pinned to the captured brain. Identity
  is process-local, not stored in Chat JSON: restored approvals can be dismissed but
  cannot execute without a retried request.

## Original PR verification

These results are the embedding-port baseline; later post-review sections record their
own focused reruns. The current Chat-search branch runs its gates separately.

| Check | Result |
| --- | --- |
| `git diff --check` | clean |
| `pnpm check` (lint + typecheck + tests + schema-drift) | pass — 136 core, 40 desktop |
| `pnpm --filter @local-brain/desktop build` | pass |
| `cargo fmt --all -- --check` | pass |
| `cargo check --workspace` | pass |
| `cargo test --workspace` | pass (47 tests) |
| `cargo test -p local-brain-desktop -- --ignored embeds_and_ranks_by_meaning` | pass |

Tests added: RRF fusion + semanticHits mapping/cutoff; `retrieve()` mode orchestration and
lexical fallback; backfill hash-skip / re-embed-on-change / prune / status counts (real
SQLite + stubbed runtime); Rust storage (`apply`/`delete`/`clear`, wrong-dim rejection),
vec0 cosine-KNN ordering, and a real end-to-end model + KNN test (ranks by meaning).

## Acceptance criteria
1. Local embedding/vector pipeline over current universal chunk projections — ✅
2. Vectors in SQLite via sqlite-vec; migrations/schema docs aligned — ✅
3. Semantic + hybrid retrieval, safe lexical fallback — ✅
4. UX/settings/status: availability, runtime status, progress/backfill/rebuild, honest
   diagnostics — ✅
5. Operable user-visible UX without note/markdown concepts — ✅
6. Focused tests incl. real SQLite — ✅
7. Docs aligned (`plan.md`, `status.md`, this report, `launch-schema.md`, plan 06) — ✅
8. Commit, push, PR — ✅ (PR link below)

## Caveats / follow-ups
- **Packaging (Plan 09):** bundling/notarizing the ONNX runtime and the on-demand ~90MB
  model download is not done here. Until then semantic search works on a dev machine; in a
  packaged build it degrades to lexical if the runtime can't load.
- **CLI stays lexical:** semantic is desktop-only. The CLI shares the DB (so
  desktop-written vectors exist) but doesn't embed queries. Adding fastembed to the CLI
  binary is a future step.
- **Filtered vec0 is bounded, not exhaustive:** sqlite-vec chooses global neighbors before
  typed SQL filters. Adaptive overfetch improves record diversity up to a bounded ceiling;
  lexical/direct-field legs remain the deterministic fallback when it cannot fill a page.

## Post-review fixes (Cursor Bugbot on PR #27)
- **High — rebuild clears without ready model:** rebuild now goes through a shared
  `rebuildEmbeddings()` that only clears + backfills once `embedEnsure()` reports `ready`;
  `loading`/`failed` throws before any `embed_clear`, so a model that can't load can't wipe
  the vectors. New `apps/desktop/src/lib/queries/embeddings.test.ts`.
- **Medium — disabled setting ignored by retrieve:** `retrieve()` checks the
  `embeddings.enabled` kill-switch before embedding the query or using vectors, even when
  the runtime stays loaded. New disabled-mode cases in `retrieve.modes.test.ts`.
- **Low — HF_HOME download/load path split:** `embed_ensure` resolves one effective cache
  dir (HF_HOME override or app-data `models`) shared by `download_model_files` and
  `TextEmbedding::try_new`. New pure `resolve_cache_dir` unit tests in `embed/mod.rs`.
- Re-verified: `git diff --check` clean, `pnpm check` (138 core + 43 desktop), desktop
  build, `cargo fmt`/`check`, `cargo test --workspace` (50 tests).

## Post-review fixes — second pass (Cursor Bugbot on PR #27, head 8470dd5)
- **Medium — failed load retriggered the ensure loop:** `EmbeddingsSync` now auto-loads the
  runtime only from `uninitialized`; a `failed` runtime is left alone instead of re-running
  the model download/load on every 1.5s status poll. `useEmbeddingsStatus` also stops polling
  on `failed` (backfill is gated on `ready`, so pending can't drain by itself). Recovery is
  user-driven — re-enabling the setting and "Rebuild index" both call `embedEnsure()`
  directly. New `apps/desktop/src/components/embeddings-sync.dom.test.tsx`.
- **Medium — KNN ignored the embedding model id:** `semanticHits` pins the `chunk_embeddings`
  join to the current `EMBEDDING_MODEL_ID`, so stale vectors from a previous model (after a
  model change or partial rebuild) can't rank into semantic/hybrid results. New model-id
  restriction case in `semantic.test.ts`.
- Re-verified (TypeScript-only pass; no `src-tauri`/crate edits, so Rust checks not re-run):
  `git diff --check` clean, `pnpm check` (139 core + 45 desktop), desktop build pass.

## Post-review fixes — third pass (Cursor Bugbot on PR #27, head 84c7349)
- **Medium — Backfill errors swallowed silently:** `EmbeddingsSync` previously
  `.catch(() => undefined)`-ed incremental backfill failures, so a backfill that threw left
  `pending > 0` while the UI kept polling and re-attempting the same failing pass — looking
  like indexing was progressing when nothing was embedded. The coordinator now persists the
  failure to a new `embeddings.backfillError` setting (surfaced on `EmbeddingsStatus`), gates
  auto-backfill on `!backfillError`, and `useEmbeddingsStatus` stops polling when it is set —
  mirroring the failed-runtime handling. A clean run clears the marker; re-enable and
  `rebuildEmbeddings()` clear it on the way in and re-persist if the rebuild itself throws.
  Settings → Semantic search shows an error box and Diagnostics reads "indexing failed: …".
  Tests: `embeddings-sync.dom.test.tsx` (persists + stops retrying), `embeddings.test.ts`
  (rebuild persists on failure), `pipeline.test.mjs` (status surfaces + clears it).
- **Medium — Whitespace queries run semantic KNN:** `retrieve()` now short-circuits on
  `query.trim().length === 0` before reading the kill-switch or runtime status, so an empty
  or whitespace-only query never embeds a blank string, never runs vec0 KNN against unrelated
  neighbours, and never reports `semanticAvailable: true` just because the runtime is ready —
  it degrades to lexical (which returns `[]` for a tokenless query). New whitespace cases in
  `retrieve.modes.test.ts`.
- Re-verified (TypeScript-only pass; no `src-tauri`/crate edits, so Rust checks not re-run):
  `git diff --check` clean, `pnpm check` (142 core + 47 desktop), desktop build pass.

## Post-review fixes — fourth pass (Cursor Bugbot on PR #27, head e83bbc1)
- **Medium — Disable does not abort backfill:** the backfill's `isStale` callback closed over
  the `status` snapshot from the render that started the run, so disabling semantic search
  mid-pass left `enabled` reading `true` and the pass ran to the end. `EmbeddingsSync` now
  reads the live `enabled` flag from the query cache inside `isStale`, so a disable observed
  between batches aborts the pass. New abort-on-disable case in `embeddings-sync.dom.test.tsx`.
- **Medium — Hybrid skips context-link boost:** hybrid fused the raw vector hits with lexical
  results, so a semantic-only record in the active context missed the explicit-link boost that
  `boostRecordIds` documents. `retrieve()` now runs `boostSemantic` over the vector hits before
  RRF fusion (matching the lexical side). New boosted-semantic-outranks case in
  `retrieve.modes.test.ts`.
- **Medium — Load can wedge Loading state:** `embed_ensure`'s terminal `Ready`/`Failed` write
  could error on a poisoned `lock_state` and leave the runtime stuck in `Loading` (later
  ensures return early and never retry). `lock_state` now recovers a poisoned mutex via
  `into_inner` — the guarded value is a small status enum — so the terminal transition always
  lands. New `load_state` recovery test in `embed/mod.rs`.
- Re-verified (Rust touched this pass): `git diff --check` clean, `pnpm check` (143 core + 48
  desktop), desktop build, `pnpm --filter @local-brain/desktop sidecar`, `cargo fmt --check`,
  `cargo check --workspace`, `cargo test --workspace` (46 tests), `cargo clippy --workspace
  --all-targets` clean.

## Post-review fixes — fifth pass (Cursor Bugbot on PR #27, head 981dd2b)
- **Medium — Stale pending stops CLI indexing:** the original fix added a slow discovery
  heartbeat and daily cap. The current follow-up supersedes that cadence: successful
  renderer mutations invalidate status immediately, while a 60-second background poll
  discovers CLI/external writes and lets the coordinator drain pending chunks with a short
  success cooldown. Settings still exposes non-destructive "Backfill now" and repair-only
  "Rebuild index".
- **Medium — Semantic available with empty hits:** in `semantic`/`hybrid` mode a `ready` runtime
  whose KNN found no neighbour within the distance cutoff still returned `semanticAvailable: true`
  with empty/unhelpful chunks and skipped the lexical fallback the unavailable-runtime path
  provides. `retrieve()` now treats an empty KNN result as "semantic contributed nothing": it
  falls through to the lexical-only result (so `semantic` mode never returns empty while lexical
  hits exist, and `hybrid` reports availability matching the fused contribution). New empty-KNN
  cases for both modes in `retrieve.modes.test.ts`.
- Re-verified (Rust touched only by re-running gates; this pass edits TypeScript only):
  `git diff --check` clean, `pnpm check` (145 core + 52 desktop tests), desktop build,
  `cargo fmt --all -- --check`, `cargo check --workspace`, `cargo test --workspace` (18 + sidecar
  suites pass).

## Post-review fixes — sixth pass (Cursor Bugbot on PR #27, head ce7cfa5)
- **Medium — Hard delete leaves orphan vectors:** `hardDeleteRecord` dropped a document's/
  interaction's `content_chunks` (and their FTS rows) but never the matching
  `chunk_embeddings`/`chunk_vectors`, which have no FK cascade (the pipeline owns that
  lifecycle so a chunk rewrite can't silently cascade-delete vectors mid-rebuild). Orphaned
  vec0 rows then consumed KNN slots until a separate prune ran. `hardDeleteRecord` now
  captures the chunk ids before the delete and calls `embedDelete` on them, so the embedding
  projection is cleaned in the same operation. The shared SQLite test harness learned
  `embed_delete`; regression test in `settings-maintenance.test.mjs` (embedded chunks are gone
  after a hard delete). Rust `delete_chunks` already drops the vec0 rows (covered by
  `embed/write.rs` tests).
- **Medium — Status poll rehashes all chunks:** `getEmbeddingsStatus` → `countPending` loaded
  every chunk and SHA-256-hashed the full text in JS on every poll (1.5s while draining, 30s
  idle), so large libraries repeatedly paid full-corpus hashing on the status path. The chunk
  text hash is now stored in `content_chunks.content_hash` at ingest/seed, and both the count
  and the backfill share a pure-SQL pending predicate (null-safe `ce.content_hash IS NOT
  cc.content_hash`, keyed on `model_id`) — `countPending` is now a `COUNT(*)` that loads no
  text and hashes nothing. `backfillEmbeddings` runs a one-time `ensureChunkHashes` to fill the
  column for legacy/seed chunks written before it existed, so the count settles instead of
  re-embedding forever. Tests: legacy-hash backfill + settle, and the existing change-detection
  test updated to mutate text + stored hash the way a re-ingest does (`pipeline.test.mjs`).
- Re-verified (TypeScript only this pass; Rust gates re-run unchanged): `git diff --check`
  clean, `pnpm check` (147 core tests + typecheck + lint), desktop build, `cargo fmt --all --
  --check`, `cargo check --workspace`, `cargo test --workspace` (18 + sidecar suites pass).

## Post-review fixes — seventh pass (Cursor Bugbot on PR #27, head 2f9bf09)
- **High — Rebuild races coordinator backfill:** manual "Rebuild index" could clear vectors and
  start a full backfill while `EmbeddingsSync` was still draining an earlier incremental pending
  snapshot. Added a renderer-wide `runExclusiveBackfill` mutex and routed both the incremental
  coordinator and manual rebuild through it. The backfill plus `setBackfillError` outcome write
  now happen inside the same exclusive section, so a stale incremental pass cannot clear a rebuild
  failure marker after the rebuild records it. Tests: `embeddings-coordinator.test.ts`,
  `embeddings.test.ts`, and `embeddings-sync.dom.test.tsx`.
- **Medium — Rebuild ignores disable abort:** `rebuildEmbeddings()` now accepts the same
  cooperative `isStale` hook as the incremental coordinator, and `useRebuildEmbeddings()` reads the
  live `embeddings-status` query cache so disabling semantic search mid-rebuild aborts between
  batches. Test: `embeddings.test.ts` verifies an already-stale rebuild clears then aborts without
  embedding a batch.
- **Medium — Hard delete splits embedding cleanup:** `hardDeleteRecord` cannot share the source
  `db_batch` transaction with `embed_delete` (which owns the vec0 rowid coupling), so the prune now
  runs before the source/chunk delete. If the embedding prune fails, the durable source rows remain
  intact and the delete is retryable; if the later batch fails, the surviving chunks are simply
  re-embedded by the idempotent backfill. Test: `settings-maintenance.test.mjs` simulates
  `embed_delete` failure and verifies the document, chunks, and embeddings all remain.
- **High — Failed mutations skip invalidation (Bugbot rerun on head 3e13b11):** the rebuild now
  persists more durable state (`setBackfillError`, `embed_clear`) before the backfill can throw, so
  `useRebuildEmbeddings`/`useSetEmbeddingsEnabled` invalidating `embeddings-status` only `onSuccess`
  left the Settings UI showing a full/healthy index after a rebuild wipe that then failed (no
  `refetchOnWindowFocus`). Both mutations now invalidate `onSettled`, so a failed run still refreshes
  the cache to the wiped/error state. Test: `embeddings-mutations.dom.test.tsx`.
- Re-verified: `git diff --check` clean, focused desktop coordinator/rebuild/sync/mutation tests and
  core maintenance/pipeline tests pass, and `pnpm check` (148 core + 58 desktop tests, existing
  first-run `act(...)` warning).

## Repo state
- Original branch: `codex/local-brain-reflect-embeddings`
- Original PR: https://github.com/maccman/local-brain/pull/27 (base `master`)
- Current follow-up branch: `codex/improve-ai-chat-search`
