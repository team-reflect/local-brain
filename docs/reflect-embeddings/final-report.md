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

## Repo state
- Branch: `codex/local-brain-reflect-embeddings`
- PR: https://github.com/maccman/local-brain/pull/27 (base `master`)
