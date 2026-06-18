# Build Manifest

Source of truth for the Local Brain implementation PR stack: stack order, branch names,
bases, scope, PR URLs, check status, verification commands, and caveats.

This manifest is maintained by the build supervisor. Update it whenever a stack layer
changes state. See also [status.md](status.md) and [decisions.md](decisions.md).

## Stack Strategy

- The build is a **dependency-aware stack of ordinary GitHub PRs** with explicit base
  branches. `gh stack` is not installed in this environment, so each PR records its base
  here instead of relying on a stack extension.
- Branch naming: `codex/local-brain-<NN>-<slug>`.
- Each PR is based on the branch immediately below it in the stack (not on `master`),
  so review can proceed layer by layer. When a lower PR merges to `master`, rebase the
  ones above it and retarget their base to `master`.
- Plan 02 (DB layer) is split into four stacked PRs (`02a` schema crate, `02b` Kysely
  codegen, `02c` Rust IPC bridge, `02d` core actions + seed) per the supervisor brief's
  allowance to split the DB layer. `02c` was split off from `02d` so the Rust bridge
  (one language, cargo-verified) reviews separately from the TypeScript domain layer.

## Environment

| Tool | State |
| --- | --- |
| node | v25.8.0 ✓ |
| pnpm | 11.5.2 ✓ |
| gh | 2.87.3, authed as `maccman` (ssh) ✓ |
| remote | `git@github.com:maccman/local-brain.git` ✓ |
| cargo / rustc | 1.96.0, installed via Homebrew on 2026-06-17 ✓ |
| rustup | not installed; Homebrew system toolchain is sufficient for local gates |
| gh stack extension | not installed — using ordinary stacked PRs |

## Stack Layers

| # | Plan | Branch | Base | Status | PR |
| --- | --- | --- | --- | --- | --- |
| 00 | Supervisor / build tracking | `codex/local-brain-00-supervisor` | `origin/master` | open | [#1](https://github.com/maccman/local-brain/pull/1) |
| 01 | Foundation & toolchain | `codex/local-brain-01-foundation` | `…-00-supervisor` | open | [#2](https://github.com/maccman/local-brain/pull/2) |
| 02a | SQLite schema crate (Rust migrations) | `codex/local-brain-02a-schema` | `…-01-foundation` | open | [#3](https://github.com/maccman/local-brain/pull/3) |
| 02b | DB package (Kysely + IPC dialect) | `codex/local-brain-02b-db` | `…-02a-schema` | open | [#4](https://github.com/maccman/local-brain/pull/4) |
| 02c | Rust IPC DB bridge (db_query/execute/batch) | `codex/local-brain-02c-bridge` | `…-02b-db` | open | [#5](https://github.com/maccman/local-brain/pull/5) |
| 02d | Core DB actions + seed data | `codex/local-brain-02d-core-db` | `…-02c-bridge` | open | [#6](https://github.com/maccman/local-brain/pull/6) |
| 03a | Desktop shell: routing, commands, core surfaces | `codex/local-brain-03-desktop-shell` | `…-02d-core-db` | open | [#7](https://github.com/maccman/local-brain/pull/7) |
| 03b | Desktop shell: Graph, Ask, full Settings, detail richness, palette | `codex/local-brain-03b-desktop-shell-ii` | `…-03-desktop-shell` | open | [#8](https://github.com/maccman/local-brain/pull/8) |
| 04 | Record ingestion | `codex/local-brain-04-ingestion` | `…-03b-desktop-shell-ii` | pending | — |
| 05 | Memory extraction & linking | `codex/local-brain-05-extraction` | `…-04-ingestion` | pending | — |
| 06 | Search, retrieval & AI | `codex/local-brain-06-search-ai` | `…-05-extraction` | pending | — |
| 07 | CLI & agent skills | `codex/local-brain-07-cli-skills` | `…-06-search-ai` | pending | — |
| 08 | Settings, backup, export & privacy | `codex/local-brain-08-settings` | `…-07-cli-skills` | pending | — |
| 09 | Packaging & launch | `codex/local-brain-09-packaging` | `…-08-settings` | pending | — |

Status legend: `pending` → not started · `in progress` → branch exists, work underway ·
`open` → PR opened · `merged` · `blocked` (see status.md).

## Per-Layer Detail

### 00 — Supervisor / build tracking
- **Scope:** `docs/build/manifest.md`, `docs/build/status.md`, `docs/build/decisions.md`.
  No app code.
- **Verification:** `git diff --check`; markdown links resolve.
- **Caveats:** none.

### 01 — Foundation & toolchain
- **Scope (Plan 01):** pnpm + Turborepo workspace, root TS config, lint/format,
  Cargo workspace, Tauri 2 app shell under `apps/desktop`, package shells
  (`packages/core`, `packages/db`, `packages/skills`), Rust crate shells
  (`apps/desktop/src-tauri`, `apps/cli`, `crates/brain-schema`), typed IPC `call()`
  wrapper with zod + casing normalization, baseline scripts
  (`typecheck`/`lint`/`test`/`check`/`dev`/`tauri`), `.gitignore`.
- **Verification:** `pnpm install` ✓; `pnpm check` ✓ (typecheck + oxlint + 6 vitest
  tests pass); migration SQL applies under `sqlite3` ✓; `node --check` on the sidecar
  script ✓; `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓;
  `cargo test --workspace` ✓.
- **Caveats:** App icon is a generated placeholder so Tauri can compile; final icon
  polish remains a Plan 09 packaging task. Sidecar bundle wiring is deferred to Plans
  07/09.

### 02a — SQLite schema crate
- **Scope (Plan 02, steps 1–7):** `crates/brain-schema` — SQL migrations for all durable
  + join tables, indexes, FTS5, migration runner, `open_and_migrate`, WAL/foreign-keys/
  busy-timeout pragmas, schema version constant, temp-db test helpers.
- **Verification:** validated under `sqlite3` 3.51 (FTS5) — 0001+0002 apply to a
  fresh DB (33 base tables, 25 indexes, 9 triggers); FK + self-row-unique + enum
  CHECK rejections fire; FTS `MATCH` returns inserted rows; cascade deletes work;
  `integrity_check`/`foreign_key_check` `ok`. `cargo test -p brain-schema`
  passes as part of `cargo test --workspace` (9 schema tests).

### 02b — DB package (Kysely + IPC dialect)
- **Scope (Plan 02, step 8):** `packages/db` — generated Kysely `Database` interface
  for all 33 durable + join tables, custom IPC dialect/driver (foundation), `json()`
  helper (foundation), camelCase normalization, schema/codegen drift script.
- **Codegen approach:** `scripts/generate-schema.mjs` replays the
  `crates/brain-schema` migrations into an in-memory database using Node's built-in
  `node:sqlite` (no native build — robust on Node 26) and introspects it to emit
  `src/schema.gen.ts`. FTS5 virtual/shadow tables are excluded (search uses raw SQL,
  Plan 06). `scripts/check-drift.mjs` regenerates and diffs against the committed
  file; it is wired into the db package's `test` script so a stale schema fails
  `pnpm check`.
- **Verification:** `pnpm check` ✓ (typecheck + oxlint + db drift check + 4 db
  vitest tests, incl. a generated-product-column camelCase→snake_case test); drift
  check fails on a stale `schema.gen.ts` (exit 1) and passes when current (exit 0).

### 02c — Rust IPC DB bridge
- **Scope (Plan 02, step 12):** `apps/desktop/src-tauri/src/db` — a managed `DbState`
  holding the single durable connection behind a mutex; `db_query` (read-only,
  rejects any non-`readonly()` statement), `db_execute` (single write), and `db_batch`
  (every statement in one transaction, rolls back on failure); JSON↔SQLite param/row
  conversion (arrays/objects round-trip as JSON text); `From<rusqlite::Error>` /
  `From<SchemaError>` for `AppError`. `lib.rs` opens + migrates the DB at startup
  (path resolved like the CLI: `$BRAIN_DB` → platform data dir) and registers the
  commands. Frontend still only wires `db_query`; the write commands are consumed by
  core in 02d.
- **Verification:** `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓;
  `cargo test --workspace` ✓ — 6 desktop bridge tests (execute+query round-trip,
  read-path write rejection, NULL→json null, JSON param round-trip, atomic batch
  commit, batch rollback on FK violation) + 9 brain-schema tests; `pnpm check` ✓.

### 02d — Core DB actions + seed
- **Scope (Plan 02, steps 9, 13):** `packages/core` — shared Kysely client over the
  bridge (`db/client.ts`), `execute`/`batch` write bindings that `.compile()` a Kysely
  query and send it to `db_execute`/`db_batch` (`db/commands.ts`), ULID id generation
  (`db/id.ts`), domain getters/setters for `people|projects|tasks|documents|
  interactions` (`createInteraction` writes the interaction + its participants in one
  `batch`), and atomic seed/demo data covering every record type incl. a memory + its
  citation.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + 11 core tests: a typechecked
  capturing-bridge unit test (asserts the compiled SQL/params per action) **and** a
  real `node:sqlite` round-trip integration test (`.test.mjs`, backed by the actual
  migrations, mirroring the Rust bridge's JSON conversion) that drives create→read→
  complete→archive across domains, the seed, and a batch rollback on an invalid FK.

### 03a — Desktop shell: routing, commands, core surfaces
- **Scope (Plan 03, steps 1–13 core):** typed `Route` discriminated union with
  URL serialize/parse (`routing/route.ts`); in-memory history router with back/forward
  synced to `window.history` (`routing/router.tsx`); central command/keymap registry +
  global shortcuts + a minimal command palette (`lib/commands/*`); the app shell
  (collapsible sidebar, top command bar, route switch); shared primitives (page head,
  dense data list, section, detail fields, empty state); and the data-backed surfaces
  **Today, Tasks (status filter + inline complete/archive), Network→People, Projects**
  plus **person/project/task/document/interaction** detail pages — all wired to the
  `@local-brain/core` getters/setters via TanStack Query, with seed-on-first-run.
  Graph, Ask, Settings, and the Organizations tab/detail are placeholders.
- **Verification:** `pnpm check` ✓ (typecheck + oxlint + 11 desktop tests: route
  serialize/parse round-trip for every route kind, and the command registry +
  **duplicate-keybinding** guard); `pnpm --filter @local-brain/desktop build` ✓ (Vite
  bundles 2025 modules); `cargo check --workspace` ✓.

### 03b — Desktop shell II
- **Scope (delivered):**
  - **Core read getters (`packages/core`):** organizations getters/setters; a
    `relations` module returning the typed join-table neighborhood per entity
    (`get<Person|Organization|Project|Task|Document|Interaction>Links`) as navigable
    `LinkedRecord`s; memories getters incl. `listMemoriesForRecord`; citations/evidence
    (`listCitationsForSubject`, `listEvidenceFromDocument`); chat conversations/messages
    getters + setters (`createConversation`, `addMessage` — message + conversation touch
    in one batch); a user-centered `getGraph` assembler (self-hub + join-table edges, node
    caps with `truncatedKinds`); and a `quickSearch` LIKE getter for the palette.
  - **Surfaces (`apps/desktop`):** SVG user-centered **Graph** (pure `graph-layout`
    radial layout, click-to-navigate, legend, truncation note); **Ask** chat shell
    (conversation list + thread + composer, persists a labeled Plan-06 placeholder answer);
    full **Settings** (General / Model keys / Local database / Backup & export / Skills /
    Diagnostics via the `settings.section` route param); **Network → Organizations** tab +
    organization detail; richer **person/organization/project/task/document/interaction**
    detail pages with `LinkedRecords` + `CitationList` + `MemoryList` sections; and a
    command palette with live record search + arrow-key navigation.
- **Decisions:** DEC-7 (single branch; hand-rolled palette instead of `cmdk`), DEC-8 (Ask
  persists a labeled placeholder answer), DEC-9 (jsdom + Testing Library render tests).
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + 47 tests (17 core incl. a new
  real-SQLite round-trip block covering organizations, person links, memories+citations,
  graph assembly, chat, and quick-search; 4 db; 26 desktop incl. graph-layout unit tests
  and jsdom render tests for `RouteContent`, the command palette record search/keyboard
  nav, and `LinkedRecords`). `pnpm --filter @local-brain/desktop build` ✓ (Vite bundles
  2039 modules). `cargo check --workspace` ✓ (no Rust changes this layer). `git diff
  --check` ✓.
- **Caveats:** no Rust changes (the existing `db_query` bridge covers every new getter). A
  full assembled `pnpm tauri dev`/`build` run was **not** performed this layer (no GUI
  session); the frontend production build and `cargo check` both pass, but an end-to-end
  app launch remains pending as noted in status.md. Ask answers and ranked/full-text
  search are placeholders until Plan 06.

### 04–09
- Scope mirrors `docs/plans/04..09`: 04 = ingestion; 05 = extraction; 06 =
  search/retrieval/Ask; 07 = `brain` CLI + skills (sidecar via `bundle.externalBin`);
  08 = settings/backup/export; 09 = macOS packaging, first-run, signing checklist.

## Open / Updated PR URLs

- PR #1 — Build 00 supervisor docs — https://github.com/maccman/local-brain/pull/1 (base `master`, open)
- PR #2 — Build 01 foundation scaffold — https://github.com/maccman/local-brain/pull/2 (base `…-00-supervisor`, open)
- PR #3 — Build 02a launch schema — https://github.com/maccman/local-brain/pull/3 (base `…-01-foundation`, open)
- PR #4 — Build 02b db package (Kysely codegen + drift check) — https://github.com/maccman/local-brain/pull/4 (base `…-02a-schema`, open)
- PR #5 — Build 02c Rust IPC DB bridge — https://github.com/maccman/local-brain/pull/5 (base `…-02b-db`, open)
- PR #6 — Build 02d core DB actions + seed — https://github.com/maccman/local-brain/pull/6 (base `…-02c-bridge`, open)
- PR #7 — Build 03a desktop shell (routing, commands, core surfaces) — https://github.com/maccman/local-brain/pull/7 (base `…-02d-core-db`, open)
- PR #8 — Build 03b desktop shell II (Graph, Ask, Settings, org browsing, detail richness, palette search) — https://github.com/maccman/local-brain/pull/8 (base `…-03-desktop-shell`, open)
