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
  Reflect's note paths. No cascade FK: the embedding pipeline owns the projection lifecycle.

### Embedding runtime (Rust, `apps/desktop/src-tauri/src/embed/`)
- `fastembed` (`all-MiniLM-L6-v2`, 384-dim) behind a `Runtime` state machine
  (uninitialized / loading+progress / ready / failed); the model downloads on demand into
  app data with byte-level progress via `hf-hub`.
- Commands: `embed_status`, `embed_ensure`, `embed_texts`, and the transactional writers
  `embed_apply` / `embed_delete` / `embed_clear` (the text↔int rowid coupling `db_batch`
  can't express, via `DbState::with_connection_mut`).
- Progress is **polled** (`embed_status`), not event-pushed: the `IpcBridge` only exposes
  `invoke`, and the app uses no Tauri events. This is the Local-Brain-shaped simplification
  of Reflect's `subscribeEmbedStatus`.

### Core (TypeScript, `packages/core/src/embeddings/`)
- `model.ts` (constants + `EmbedStatus` zod union), `commands.ts` (typed IPC wrappers),
  `semantic.ts` (vec0 KNN via a CTE + RRF fusion), `pipeline.ts` (hash-skip incremental
  backfill / clear / prune over `content_chunks`), `status.ts` (`getEmbeddingsStatus`,
  enable toggle).
- `retrieve()` keeps its one shared contract. Semantic/hybrid embed the query, run the
  vec0 KNN (24 candidates, cosine ≤ 0.7), and blend with lexical via Reciprocal Rank Fusion
  (K=60). Any failure (no runtime, non-desktop host, embed error) degrades to lexical with
  `semanticAvailable: false`. Ask's citations and model boundary are untouched.

### Desktop UX (`apps/desktop`)
- `EmbeddingsSync` headless coordinator (loads the model + runs incremental backfill,
  including for records the CLI wrote while the app was closed).
- Settings → **Semantic search**: enable/disable, model download progress bar, runtime +
  index status (indexed/total, pending), "Rebuild index".
- Diagnostics now reports the real semantic state instead of a hardcoded "off".

### Tooling
- The schema codegen and the JS test harness strip `CREATE VIRTUAL TABLE … USING vec0`
  before replaying migrations into Node's built-in SQLite (which lacks the extension) —
  like FTS5, vec0 tables are raw-SQL-only and excluded from the typed builder. `schema.gen.ts`
  regenerated with `chunkEmbeddings`.

## Verification

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
1. Local embedding/vector pipeline for documents/interactions chunks — ✅
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
- **CLI stays lexical:** semantic is desktop-only. The CLI shares the DB (so desktop-written
  vectors exist) but doesn't embed queries. Adding fastembed to the CLI binary is a future
  step.
- **No live ingest hook:** backfill runs on enable / app start / manual rebuild; it is
  hash-skip cheap. A push-on-write trigger could be added later.

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
- **Medium — Stale pending stops CLI indexing:** once semantic search was enabled and `pending`
  hit 0, `useEmbeddingsStatus` stopped polling entirely, so chunks written by a non-UI path (the
  `brain` CLI indexing while the window is open, or another window) were never embedded until a
  focus/settings refetch. The refetch cadence is now an extracted, exported pure function,
  `embeddingsRefetchInterval`: it still fast-polls (1.5s) while loading or draining and still
  stops dead on a `failed` runtime or sticky `backfillError`, but when idle-and-healthy it keeps
  a slow 30s heartbeat so `EmbeddingsSync` notices externally written chunks on its own — without
  reintroducing the 1.5s hammering the failure guards exist to prevent. New cadence-contract
  cases in `embeddings.test.ts`.
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

## Repo state
- Branch: `codex/local-brain-reflect-embeddings`
- PR: https://github.com/maccman/local-brain/pull/27 (base `master`)
