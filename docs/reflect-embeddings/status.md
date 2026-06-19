# Reflect Embeddings → Local Brain: Status

Branch: `codex/local-brain-reflect-embeddings` · Base: `master` @ 58c801f

## Current phase

**Done — verification green.** Cursor Bugbot review fixes applied on top of PR #27
(see "Bugbot fixes" below). See `final-report.md`.

## Progress log

- ✅ Understanding pass: mapped Local Brain retrieval/native/settings + Reflect Open
  (primary) and Reflect Next (secondary) embedding systems. Decisions in `plan.md`.
- ✅ Phase A — Rust storage + sqlite-vec: workspace + brain-schema deps;
  `register_sqlite_vec()` (process-global auto-extension) in `open_and_migrate`/
  `open_in_memory`; migration `0003_embeddings.sql` (`chunk_embeddings` + `chunk_vectors`
  vec0 cosine 384-dim); `LATEST_SCHEMA_VERSION` → 3. Real vec0 cosine-KNN test.
- ✅ Phase B — Rust embed runtime + commands: `apps/desktop/src-tauri/src/embed/`
  (fastembed `all-MiniLM-L6-v2`, polled progress); `embed_status/ensure/texts/apply/
  delete/clear`; transactional `DbState::with_connection_mut`. Storage tests vs real
  SQLite. Ignored end-to-end test (real model + real KNN) passes locally.
- ✅ Phase C — TS core embeddings module: `model/commands/semantic/pipeline/status`;
  `retrieve()` now does real semantic + hybrid (RRF K=60, KNN 24, cosine ≤ 0.7) and
  degrades to lexical with `semanticAvailable: false`. Exported from core.
- ✅ Phase D — Desktop UX: `EmbeddingsSync` headless coordinator; Settings "Semantic
  search" section (enable/disable, download progress, index status, manual backfill,
  rebuild); Diagnostics now reports the real state.
- ✅ Phase E — Tests: RRF fusion, semanticHits mapping/cutoff, retrieve mode orchestration
  + fallback (TS); backfill hash-skip, re-embed-on-change, prune, status counts (real
  SQLite harness + stubbed runtime); Rust storage + vec0 KNN + e2e.
- ✅ Phase F — Docs aligned (`launch-schema.md`, plan 06); codegen + JS test harness strip
  vec0 statements (Node SQLite lacks the extension); `schema.gen.ts` regenerated.

## Bugbot fixes (post-review pass on PR #27)
- ✅ **High — rebuild clears without ready model.** `useRebuildEmbeddings` now calls a
  shared `rebuildEmbeddings()` that only `clearEmbeddings()` + `backfillEmbeddings()`
  once `embedEnsure()` confirms `ready`; a `loading` (concurrent load) or `failed`
  result throws *before* the clear, so a model that can't load can't wipe the index.
  Tests: `apps/desktop/src/lib/queries/embeddings.test.ts` (ready clears; loading/failed
  abort without `embed_clear`).
- ✅ **Product cadence — automatic backfill capped daily.** `EmbeddingsSync` now runs
  automatic incremental backfill at most once per local calendar day per brain, recorded in
  `embeddings.lastBackfillAttemptDay`. Pending chunks no longer ride a 30s idle heartbeat;
  active backfills still fast-poll progress, and a slow hourly discovery poll runs only until
  today's automatic slot is used. Settings has a non-destructive "Backfill now" button for
  explicit catch-up while "Rebuild index" remains the destructive repair action.
- ✅ **Medium — disabled setting ignored by retrieve.** `retrieve()` now reads the
  `embeddings.enabled` kill-switch before touching the runtime; when disabled it never
  embeds the query or uses vectors, even if the in-memory model stays loaded, and reports
  `semanticAvailable: false`. Tests added in `retrieve.modes.test.ts` (hybrid + semantic
  short-circuit to lexical when disabled, no `embed_status`/`embed_texts`).
- ✅ **Low — HF_HOME download/load path split.** `embed_ensure` resolves one
  `effective_cache_dir` (HF_HOME override or app-data `models`) and passes it to BOTH
  `download_model_files` and `TextEmbedding::try_new`, so progress and the loader agree on
  one cache path. Pure `resolve_cache_dir` unit tests in `embed/mod.rs` (`cache_dir` mod).

## Bugbot fixes (second review pass on PR #27, head 8470dd5)
- ✅ **Medium — failed load retriggered the ensure loop.** `EmbeddingsSync` only
  auto-`embedEnsure()`s from `uninitialized` now; a `failed` runtime no longer re-triggers
  the model download/load on every status poll. Recovery is user-driven — re-enabling the
  setting and "Rebuild index" both call `embedEnsure()` directly. The status poll also
  stops when the runtime is `failed` (`useEmbeddingsStatus` `refetchInterval`), since
  backfill is gated on `ready` and pending can never drain on its own. Test:
  `apps/desktop/src/components/embeddings-sync.dom.test.tsx` (ensures on `uninitialized`,
  does not on `failed`).
- ✅ **Medium — KNN ignored the embedding model id.** `semanticHits` now pins the
  `chunk_embeddings` join to the current `EMBEDDING_MODEL_ID`, so vectors left from an
  older model (after a model change or partial rebuild) can't rank into semantic/hybrid
  results. Test added in `semantic.test.ts` (query restricts `model_id`).

## Bugbot fixes (third review pass on PR #27, head 84c7349)
- ✅ **Medium — Backfill errors swallowed silently.** `EmbeddingsSync` no longer
  `.catch(() => undefined)`s incremental backfill failures. A thrown backfill is persisted
  to a new `embeddings.backfillError` setting (surfaced on `EmbeddingsStatus`); a clean run
  (completed or disable-aborted) clears it. The coordinator gates auto-backfill on
  `!backfillError` and `useEmbeddingsStatus` stops polling when it is set — so a failing
  backfill is reported instead of looping while the UI pretends indexing is progressing.
  Recovery is explicit: re-enable and `rebuildEmbeddings()` both clear the marker first and
  re-persist if the rebuild itself throws. Settings/Diagnostics show "indexing failed: …"
  and an error box. Tests: `embeddings-sync.dom.test.tsx` (persists + stops retrying),
  `embeddings.test.ts` (rebuild persists on failure), `pipeline.test.mjs` (status surfaces
  + clears the persisted error).
- ✅ **Medium — Whitespace queries run semantic KNN.** `retrieve()` now guards on
  `query.trim().length > 0` before reading the kill-switch / runtime status, so a blank or
  whitespace-only query never embeds, never runs vector KNN, and never reports
  `semanticAvailable: true` just because the runtime is ready (it degrades to lexical, which
  itself returns `[]` for a tokenless query). Tests added in `retrieve.modes.test.ts`
  (hybrid + semantic skip embed/KNN for whitespace-only input).

## Verification results (third review pass, no Rust touched)
- `git diff --check` — clean
- `pnpm check` — pass (lint + typecheck + 142 core + 47 desktop tests + schema-drift)
- `pnpm --filter @local-brain/desktop build` — pass
- Rust checks not re-run: this pass changed only TypeScript (no `src-tauri`/crates edits).
  Prior Rust verification still holds — `cargo fmt`/`check`/`test --workspace` (50 tests)
  and the ignored `embeds_and_ranks_by_meaning` e2e all passed in the first review pass.

## Bugbot fixes (fourth review pass on PR #27, head e83bbc1)
- ✅ **Medium — Disable does not abort backfill.** The incremental backfill's `isStale`
  callback captured the `status` snapshot from the render that started the run, so disabling
  semantic search mid-pass never aborted it — `enabled` stayed `true` to the closure and the
  pass ran to completion. `EmbeddingsSync` now reads the LIVE `enabled` flag from the query
  cache (`queryClient.getQueryData(EMBEDDINGS_STATUS_KEY)`) inside `isStale`, so a disable
  observed between batches aborts the pass. Test: `embeddings-sync.dom.test.tsx` ("aborts an
  in-flight backfill when semantic search is disabled mid-pass" — 40 pending chunks, disable
  after the first batch, exactly one batch embeds).
- ✅ **Medium — Hybrid skips context-link boost.** Semantic mode applied `boostRecordIds`
  via `boostSemantic`, but hybrid fused the *raw* vector hits with lexical results, so a
  semantic-only neighbour in the active context missed the explicit-link boost documented on
  `RetrieveOptions`. `retrieve()` now applies `boostSemantic` to the vector hits before RRF
  fusion, matching the lexical side (whose boost rides in `combineScore`). Test added in
  `retrieve.modes.test.ts` (a farther but boosted semantic-only record outranks the closer
  unboosted one).
- ✅ **Medium — Load can wedge Loading state.** After `spawn_blocking` finished, the terminal
  `Ready`/`Failed` write went through `lock_state(&state)?`; a poisoned lock would error there
  and leave the runtime in `Loading` forever (later `embed_ensure` calls return early on
  `Loading` and never retry). `lock_state` now recovers a poisoned mutex (`into_inner`) rather
  than erroring — the guarded value is a small status enum a panic can't corrupt — so the
  terminal transition always lands. Test: `embed/mod.rs` (`load_state` mod) poisons the mutex
  mid-`Loading` and asserts the terminal write still reaches `Failed`.

## Verification results (fourth review pass, Rust touched)
- `git diff --check` — clean
- `pnpm check` — pass (lint + typecheck + 143 core + 48 desktop tests + schema-drift)
- `pnpm --filter @local-brain/desktop build` — pass
- `pnpm --filter @local-brain/desktop sidecar` — built the staged `brain` CLI sidecar
- `cargo fmt --all -- --check` — clean
- `cargo check --workspace` — pass
- `cargo test --workspace` — pass (46 tests, incl. the new `load_state` recovery test)
- `cargo clippy --workspace --all-targets` — clean

## Caveats
- Bundling/notarizing the ONNX runtime and the on-demand ~90MB model download still need a
  packaging pass (Plan 09). The runtime degrades to lexical if unavailable, so nothing
  breaks without it.
- Semantic search is desktop-only; the `brain` CLI keeps its Rust lexical search (no
  embedding runtime in the CLI binary). Documented trade-off — the CLI shares the same DB,
  so vectors written by the desktop are present but the CLI does not query them yet.
- The e2e model test is `#[ignore]` (network + ~90MB); it passed against a locally cached
  model during development.
