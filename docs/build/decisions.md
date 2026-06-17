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
