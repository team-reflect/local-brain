# Reflect Embeddings → Local Brain: Status

Branch: `codex/local-brain-reflect-embeddings` · Base: `master` @ 58c801f

## Current phase

**Done — verification green.** Awaiting push + PR. See `final-report.md`.

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
  search" section (enable/disable, download progress, index status, rebuild); Diagnostics
  now reports the real state.
- ✅ Phase E — Tests: RRF fusion, semanticHits mapping/cutoff, retrieve mode orchestration
  + fallback (TS); backfill hash-skip, re-embed-on-change, prune, status counts (real
  SQLite harness + stubbed runtime); Rust storage + vec0 KNN + e2e.
- ✅ Phase F — Docs aligned (`launch-schema.md`, plan 06); codegen + JS test harness strip
  vec0 statements (Node SQLite lacks the extension); `schema.gen.ts` regenerated.

## Verification results
- `git diff --check` — clean
- `pnpm check` — pass (lint + typecheck + 136 core + 40 desktop tests + schema-drift)
- `pnpm --filter @local-brain/desktop build` — pass
- `cargo fmt --all -- --check` — pass
- `cargo check --workspace` — pass
- `cargo test --workspace` — pass (47 tests)
- `cargo test -p local-brain-desktop -- --ignored embeds_and_ranks_by_meaning` — pass
  (real fastembed model + real sqlite-vec KNN ranked by meaning)

## Caveats
- Bundling/notarizing the ONNX runtime and the on-demand ~90MB model download still need a
  packaging pass (Plan 09). The runtime degrades to lexical if unavailable, so nothing
  breaks without it.
- Semantic search is desktop-only; the `brain` CLI keeps its Rust lexical search/ask (no
  embedding runtime in the CLI binary). Documented trade-off — the CLI shares the same DB,
  so vectors written by the desktop are present but the CLI does not query them yet.
- The e2e model test is `#[ignore]` (network + ~90MB); it passed against a locally cached
  model during development.
