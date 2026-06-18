# Reflect Embeddings → Local Brain: Plan

Port Reflect Next/Open's local embedding + semantic search system into Local Brain,
adapted to Local Brain's schema (SQLite product tables + derived `content_chunks`),
its IPC contract, and its settings/diagnostics UX.

Primary technical reference: **Reflect Open** (`/Users/cloud/repos/team-reflect/reflect-open`)
— Rust-side `fastembed` + `sqlite-vec`, the path `docs/plans/libraries.md` already commits to.
Reflect Next's WebGPU/Transformers.js approach is **rejected**: it targets a browser/web
product, not a Tauri desktop app, and contradicts the stated library direction.

## What already exists in Local Brain

- `packages/core/src/retrieval/retrieve.ts` — the shared retrieval contract. Accepts
  `mode: lexical | semantic | hybrid` (default `hybrid`) but hardcodes
  `semanticAvailable: false` and only runs FTS5 over `content_chunks`.
- `packages/core/src/retrieval/ranking.ts` — `lexicalScore` (bm25→[0,1]), `recencyScore`
  (90-day half-life), `combineScore` (lexical·0.7 + recency·0.3, ×1.25 if linked).
- `packages/core/src/ingest/{chunk,ingest,hash}.ts` — paragraph-aware chunking
  (`maxChars` 1000), SHA-256 `contentHash`, writes `content_chunks` rows via a Kysely
  batch through IPC. Chunk text is the unit we embed.
- `crates/brain-schema` — durable schema + `open_and_migrate`/`open_in_memory`.
  Migrations `0001_init.sql`, `0002_launch_schema.sql`; `LATEST_SCHEMA_VERSION = 2`.
  rusqlite 0.40.1 bundled. No `sqlite-vec` yet. `content_chunks(id TEXT PK, record_type,
  record_id, chunk_index, text, token_count, content_hash, created_at)` +
  `content_chunks_fts` (external-content FTS5).
- `apps/desktop/src-tauri` — Rust owns one `Mutex<Connection>` (`DbState`). Commands:
  `db_query` (read-only), `db_execute`, `db_batch` (txn), plus `app_version`,
  `database_path`, `fs::*`, `keychain::*`. TS calls them through the generic
  `IpcBridge.invoke` + zod-validated `call()`.
- `apps/desktop/src/surfaces/settings.tsx` — sections general / model-keys / database /
  skills / diagnostics. Diagnostics hardcodes `['semantic search', 'off (lexical fallback)']`.
  Settings read/write via react-query hooks in `apps/desktop/src/lib/queries/settings.ts`.
- `apps/cli` — **separate Rust** lexical search/ask (`commands/read.rs`); model via `curl`.
  Out of scope for semantic for MVP (stays lexical fallback).

## Design decisions (Local-Brain-shaped)

1. **Vectors attach to `content_chunks`, not notes.** Reflect keys embeddings by
   `note_path`; Local Brain's durable derived chunk table is `content_chunks` (text id).
   We add a `chunk_embeddings` table keyed to `content_chunks.id` plus a `vec0` virtual
   table for the float vectors. No FK from `chunk_embeddings` to `content_chunks` cascade —
   the embedding pipeline owns the embedding lifecycle (mirrors Reflect Open's rationale).

2. **vec0 needs an integer rowid; `content_chunks.id` is TEXT.** So `chunk_embeddings`
   gets an `INTEGER PRIMARY KEY AUTOINCREMENT id`, and `chunk_vectors(rowid)` ==
   `chunk_embeddings.id`. The text↔int coupling and atomic insert of (row + vector) live
   in a small Rust write command (`embed_apply`), exactly like Reflect Open's
   `embed_write.rs`. Storage stays consistent without leaking rowids through Kysely.

3. **Embedding generation lives in Rust** (`fastembed`, `all-MiniLM-L6-v2`, 384-dim,
   cosine), behind new Tauri commands. The TS core never embeds in-process.

4. **Status via polling, not events.** The `IpcBridge` only exposes `invoke`, and the app
   uses no Tauri events today. `embed_status` is a plain command; react-query polls it
   while loading. (Reflect's `subscribeEmbedStatus` event path is intentionally not ported.)

5. **Retrieval stays one contract.** `retrieve()` keeps its signature/return shape. When
   the runtime is `ready` and the requested mode is `semantic`/`hybrid`, it embeds the
   query (IPC), runs a `vec0` KNN, and fuses with the lexical hits via Reciprocal Rank
   Fusion (RRF, K=60). Otherwise it degrades to lexical and reports
   `semanticAvailable: false`. `RetrievedChunk` gains an optional `semanticScore`.

6. **`sqlite-vec` registered in `brain-schema`** before migrate/open (process-global
   auto-extension, `OnceLock`), so the desktop and the CLI share one registration and the
   `vec0` migration runs everywhere. fastembed is desktop-only.

## Schema (migration `0003_embeddings.sql`, bump `LATEST_SCHEMA_VERSION` → 3)

```sql
CREATE TABLE chunk_embeddings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id     TEXT NOT NULL,         -- content_chunks.id (no cascade; pipeline-owned)
  content_hash TEXT NOT NULL,         -- SHA-256 of the chunk text that was embedded
  model_id     TEXT NOT NULL,         -- e.g. all-MiniLM-L6-v2 (re-embed on model change)
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(chunk_id, model_id)
);
CREATE INDEX chunk_embeddings_chunk ON chunk_embeddings(chunk_id);

CREATE VIRTUAL TABLE chunk_vectors USING vec0(embedding float[384] distance_metric=cosine);
-- chunk_vectors.rowid == chunk_embeddings.id
```

## Work breakdown

### Phase A — Rust storage + sqlite-vec
- Add `sqlite-vec = "0.1.9"` to the workspace; `register_sqlite_vec()` in `brain-schema`
  called from `open_and_migrate`/`open_in_memory`.
- Migration `0003_embeddings.sql`; bump version; extend brain-schema tests (table exists,
  vec0 round-trips, KNN orders by cosine distance).

### Phase B — Rust embed runtime + commands (desktop)
- `apps/desktop/src-tauri/src/embed/` module: `fastembed` runtime behind
  `Runtime { Uninitialized | Loading{progress} | Ready{model} | Failed{message} }`,
  `Arc<Mutex<TextEmbedding>>`. Model cache under app data dir; download progress tracked.
- Commands: `embed_status`, `embed_ensure`, `embed_texts`, `embed_apply` (insert
  chunk_embeddings + chunk_vectors atomically, replacing prior (chunk_id, model_id)),
  `embed_delete` (by chunk ids), `embed_clear` (rebuild). Register in `lib.rs`; share
  `DbState` for writes.

### Phase C — TS core embeddings module
- `packages/core/src/embeddings/`: `model.ts` (constants, `EmbedStatus` zod + types),
  `commands.ts` (typed IPC wrappers via `call()`), `pipeline.ts` (`backfillEmbeddings`
  with hash-skip over `content_chunks`; `clearEmbeddings`), `status.ts`
  (`getEmbeddingsStatus`: runtime + indexed/pending counts), `semantic.ts`
  (`semanticHits` vec0 KNN, `fuseRanked` RRF). Export through `src/index.ts`.
- Wire `retrieve()` semantic/hybrid; keep lexical fallback + `semanticAvailable`.

### Phase D — Desktop UX
- `lib/queries/embeddings.ts` — `useEmbedStatus` (polls while loading), `useEmbeddingsStatus`,
  mutations for enable/disable/rebuild.
- `<EmbeddingsSync>` mounted component: when enabled + ready, run backfill (serialized);
  re-check on app start.
- Settings "Semantic search" section: enable toggle (persisted in `settings`), model
  download progress, runtime/index status, "Rebuild embeddings" button. Update Diagnostics
  line to reflect real status.

### Phase E — Tests
- TS: chunk-hash stability, RRF fusion ranking, semantic→lexical fallback, pipeline
  hash-skip, status counts, settings/queries behavior (bridge spy).
- Rust: migration/vec0 round-trip + KNN ordering, `embed_apply`/`embed_delete`/`embed_clear`
  against real in-memory SQLite, status state machine where feasible.

### Phase F — Docs + verification + PR
- Keep `docs/reflect-embeddings/{plan,status,final-report}.md` aligned; update
  `docs/launch-schema.md` / relevant plan for the new derived tables and semantic mode.
- Run: `git diff --check`, `pnpm check`, `pnpm --filter @local-brain/desktop build`,
  `cargo fmt --all -- --check`, `cargo check --workspace`, `cargo test --workspace`.
- Commit incrementally; push branch; open PR vs `master`.

## Acceptance criteria (from the brief)
1. Local embedding/vector pipeline for documents/interactions chunks. → Phases A–C
2. Vectors in SQLite via sqlite-vec; migrations/schema docs aligned. → Phase A, F
3. Semantic + hybrid retrieval; safe lexical fallback. → Phase C
4. UX/settings/status: availability, runtime status, progress/backfill/rebuild, honest
   diagnostics. → Phase D
5. Port enough UX to be operable; no note/markdown-specific concepts. → Phase D
6. Focused tests incl. real SQLite where meaningful. → Phase E
7. Docs aligned. → Phase F
8. Commit, push, PR. → Phase F

## Risks / caveats
- **fastembed + sqlite-vec packaging/build** on macOS (ONNX runtime, model download,
  notarization). Highest risk. If the Rust build or model download is infeasible in this
  environment, document the exact blocker in `status.md` and stop — do not fake it.
- Model download (~90 MB) on first enable; needs network. Progress UX mitigates.
- CLI semantic is out of scope (stays lexical); documented trade-off.
- `content_chunks` has no per-chunk stored hash today; the pipeline hashes chunk text
  (SHA-256) at embed time — stable and matches the ingest hash convention.
- Re-ingest currently inserts new `content_chunks` (no in-place update path observed);
  backfill is keyed by current chunk id + text hash, so stale embeddings are pruned by
  `embed_delete`/rebuild rather than relying on cascade.
```
