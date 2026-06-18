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
| 04a | Ingestion core engine (chunking, hashing, ingest + links + dedupe) | `codex/local-brain-04a-ingestion-core` | `…-03b-desktop-shell-ii` | open | [#9](https://github.com/maccman/local-brain/pull/9) |
| 04b | Rust file-read primitives (safe reads, size caps, hashing, folder enum) | `codex/local-brain-04b-ingestion-fs` | `…-04a-ingestion-core` | open | [#10](https://github.com/maccman/local-brain/pull/10) |
| 04c | Ingestion UI (paste/import flows, folder import, Add actions) | `codex/local-brain-04c-ingestion-ui` | `…-04b-ingestion-fs` | open | [#11](https://github.com/maccman/local-brain/pull/11) |
| 05a | Extraction engine (contracts, preprocessing, merge/apply, model seam) | `codex/local-brain-05a-extraction-engine` | `…-04c-ingestion-ui` | open | [#12](https://github.com/maccman/local-brain/pull/12) |
| 05b | Extraction corrections + relationship intelligence (UI/setters) | `codex/local-brain-05b-corrections` | `…-05a-extraction-engine` | open | [#14](https://github.com/maccman/local-brain/pull/14) |
| 06 | Search, retrieval & AI (incl. the model-backed extractor) | `codex/local-brain-06-search-ai` | `…-05b-corrections` | open | [#15](https://github.com/maccman/local-brain/pull/15) |
| 07 | CLI & agent skills | `codex/local-brain-07-cli-skills` | `…-06-search-ai` | open | [#16](https://github.com/maccman/local-brain/pull/16) |
| 08 | Settings, backup, export & privacy | `codex/local-brain-08-settings-backup-privacy` | `…-07-cli-skills` | open | [#17](https://github.com/maccman/local-brain/pull/17) |
| 09 | Packaging & launch | `codex/local-brain-09-packaging-launch` | `…-08-settings-backup-privacy` | open | [#19](https://github.com/maccman/local-brain/pull/19) |

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

### 04a — Ingestion core engine
- **Scope (Plan 04, steps 7–10 core, language=TS):** `packages/core/src/ingest` — text
  `normalizeText` + paragraph-aware `chunkText`; `contentHash` (SHA-256 hex via Web Crypto,
  chosen to match the future Rust `sha2` import path so a pasted note and an imported file
  dedupe identically); `ingestDocument` / `ingestInteraction` that normalize → hash →
  dedupe-check → write the record + its `content_chunks` + optional people/orgs/projects/
  tasks links in **one** `db_batch` transaction; and an `extraction-queue` seam
  (`markForExtraction` / `setExtractionHandler`, no-op until Plan 05).
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + **57 tests** (27 core incl. 6
  chunk/normalize unit tests and a new real-SQLite ingestion block: normalized body +
  chunks + content hash + links, duplicate detection + `allowDuplicate`, interaction
  participant links, and atomic rollback on an invalid link FK; 4 db; 26 desktop).
  `cargo check --workspace` ✓ (no Rust this layer). `git diff --check` ✓.
- **Caveats:** UI Add/import flows are 04c; Rust safe file reads + folder import are 04b.

### 04b — Rust file-read primitives
- **Scope (Plan 04, steps 3–6, language=Rust):** `apps/desktop/src-tauri/src/fs.rs` — a
  `read_text_file` command (canonicalize the user-selected path, require a regular file,
  enforce a 5 MiB size cap, require valid UTF-8, detect kind by extension, SHA-256 the
  bytes) and a `read_text_folder` command (recursive scan that skips hidden / unsupported /
  oversized / binary / duplicate files and anything that resolves outside the chosen root
  via a symlink, with per-file skip reasons + imported/skipped counts). Registered in
  `lib.rs`; added `sha2` to the workspace. Typed TS bindings (`readTextFile` /
  `readTextFolder` + zod) in `packages/core/src/ipc/fs.ts`.
- **Hashing note:** the Rust `content_hash` is SHA-256 over the file's raw UTF-8 bytes and
  is used to flag duplicate files *within a folder scan*. The authoritative cross-record
  dedupe hash is the 04a one, computed at ingest over *normalized* text — so the UI (04c)
  passes `contents` to `ingestDocument`, which owns the stored hash.
- **Verification:** `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓;
  `cargo test --workspace` ✓ — 12 tests (3 new `fs` tests: read+hash a text file; reject
  unsupported/missing/binary; folder scan skipping hidden/unsupported/duplicate + recursion;
  plus the 9 existing). `pnpm check` ✓ (the new zod bindings typecheck). `git diff --check` ✓.

### 04c — Ingestion UI (Plan 04 complete)
- **Scope (Plan 04, steps 1–2, 11, language=TS/React):** `AddRecordDialog` — a modal with a
  Document/Interaction toggle and a Paste/Import-folder mode toggle. Paste mode: title, kind,
  date, a body textarea, an optional "load from file path" that calls `readTextFile` (04b),
  and collapsible people/projects/organizations/tasks link pickers; Save runs
  `ingestDocument`/`ingestInteraction` (04a), surfaces the duplicate notice, and navigates to
  the record. Folder mode: a path field → `readTextFolder` (04b) → `ingestDocument` per file,
  reporting imported/duplicate/skipped counts. Wired via a new `openAdd` on `CommandContext`,
  the `new.document`/`new.interaction` palette commands, and an **Add** button in the command
  bar. `useIngestDocument`/`useIngestInteraction` mutations invalidate broadly.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + **61 tests** (27 core, 4 db, 30
  desktop incl. 4 new `AddRecordDialog` render tests: compose fields + type toggle, empty-body
  guard, paste→ingest→close, folder-mode field). `pnpm --filter @local-brain/desktop build` ✓
  (Vite bundles 2041 modules). `cargo check --workspace` ✓ (no Rust this layer). `git diff
  --check` ✓.
- **Caveats:** file/folder selection is via a typed **path field** (not a native picker) so
  the build stays hermetic and testable; wiring the Tauri dialog plugin for a native file
  picker is a follow-up. PDF/OCR and automatic sync remain out of scope (Plan 04 open
  questions). A full assembled `pnpm tauri dev`/`build` launch is still pending.

### 05a — Extraction engine (deterministic half of Plan 05)
- **Scope (Plan 05, steps 1-2, 4-7 — the deterministic, no-model half):**
  `packages/core/src/extraction` —
  - `contracts.ts`: zod schemas + types for the **extraction output contract** (the
    exact shape a model must produce): people, organizations, affiliations, projects,
    tasks, memories, evidence refs; entities linked by local `ref`s. `parseExtractionResult`
    + `validateExtraction` (graph integrity: ref uniqueness, resolvable/typed references).
  - `preprocess.ts`: deterministic pre-processing — `findDates`/`findEmails`,
    `selectChunks`, and `buildExtractionContext` (loads a source record's chunks, hint
    signals, known participants, and dedupe candidates for the model).
  - `match.ts`: deterministic merge/upsert matching — `normalizeName`/`normalizeEmail`/
    `normalizeDomain`, `matchPerson`/`matchOrganization`/`matchProject` (exact key first,
    then normalized name).
  - `apply.ts` + `apply-store.ts`: `applyExtraction` — resolve every ref to an
    existing-or-new row (merge/upsert), write new records, link them back to the source,
    create hidden memories with `memory_links`, and attach `evidence_refs` to chunks, all
    in **one** `db_batch`. Confidence gating (`minConfidence`) turns low-confidence
    entities into suggestions instead of writes; obvious duplicates (people/orgs by
    key+name, projects/tasks by name, memories by claim) are skipped; unresolved
    evidence/links are reported, never guessed.
  - `extractor.ts`: the **typed model seam** — an `Extractor` takes the deterministic
    context and returns model output; `runExtraction` validates + applies it;
    `installExtractionPipeline` wires it as the fire-and-forget ingest-queue handler. No
    extractor is registered by default (the model-backed adapter lands with Plan 06 model
    plumbing), so `runExtraction` is a safe no-op until then — **no faked heuristics**.
- **Sequencing (DEC-12):** Plan 05's only model-dependent step (step 3, "build model
  extraction") needs the Plan 06 BYOK model boundary; everything else is deterministic.
  This PR builds that deterministic engine *around* an explicit typed seam; the
  model-backed extractor is deferred to Plan 06. Correction flows (step 8) + relationship
  intelligence (step 9) become **05b**.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint (clean, no warnings) + **89 tests**
  (53 core: +11 match, +5 preprocess, +6 contracts unit tests, +4 real-SQLite golden
  apply tests — meeting→people/org/project/task/cited-memory, merge/upsert + idempotency,
  confidence-gated suggestions, the extractor seam; 4 db; 30 desktop unchanged) plus the
  desktop Vite build (2041 modules) and `cargo check --workspace` ✓ (no Rust this layer).
  `git diff --check` ✓.
- **Caveats:** matching is exact-key/normalized-name (conservative — fuzzy/embedding match
  is a follow-up); matched existing tasks gain a source link + evidence but their fields and
  person/org links are not mutated (correction is 05b); enrichment of matched people/orgs is
  deferred to 05b. The model-backed extractor and golden tests over *live model output*
  await Plan 06.

### 05b — Extraction corrections + relationship intelligence (Plan 05 complete)
- **Scope (Plan 05, steps 8–9, deterministic):**
  - **Correction setters (`packages/core`):**
    - memories (`memories/setters.ts`): `updateMemory`, `archiveMemory` (soft-delete),
      `unlinkMemoryFromRecord` / `linkMemoryToRecord` (fix a memory's `memory_links`).
    - typed record links (`relations/setters.ts`): `unlinkRecords(a, b)` — one undirected,
      order-independent setter over a 15-relation registry covering every join surfaced on
      the detail pages, plus the two non-join cases (person↔org `affiliations`, project↔task
      `tasks.project_id`). Each maps to a single delete/clearing update, so the write is
      inherently atomic.
    - evidence/citations (`citations/setters.ts`): `updateEvidenceRef` (repoint chunk / fix
      span / edit note) and `removeEvidenceRef` (drop a wrong citation; the grounded subject
      is untouched).
  - **Relationship intelligence (`relationships/`):** `strength.ts` (pure, unit-tested date
    math + the transparent 1–5 strength formula), `recompute.ts`
    (`recomputeRelationshipIntelligence` / `recomputeAllRelationships` — derive
    `last_interaction_at`, `next_reconnect_at`, and `relationship_strength` from
    interactions/tasks), and `getters.ts` (`listReconnectSuggestions`). Recompute runs
    incrementally after a relevant interaction (create/ingest/apply) and in bulk on first-run
    seed. See **DEC-13** for what it owns and why important dates are deferred.
  - **UI (`apps/desktop`):** the shared `LinkedRecords`, `MemoryList`, and `CitationList`
    gained in-place correction affordances (Unlink / Archive / Remove), wired through all six
    detail pages; person detail shows the derived "Reconnect by" field; Today gained a
    **Reconnect** section over `listReconnectSuggestions`. New TanStack hooks
    (`useUnlinkFrom`, `useUnlinkRecord`, `useArchiveMemory`, `useUnlinkMemory`,
    `useRemoveEvidenceRef`, `useReconnectSuggestions`) invalidate broadly.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint (clean) + **109 tests** (72 core:
  +7 strength unit, +10 real-SQLite corrections/recompute round-trips; 4 db; 33 desktop: +2
  correction-affordance render tests, +1 Today reconnect render test). `pnpm --filter
  @local-brain/desktop build` ✓ (2057 modules). `cargo check --workspace` n/a (no Rust this
  layer). `git diff --check` ✓.
- **Caveats:** `important_dates_json` is not derived (no schema field supplies dates — DEC-13).
  Recompute is per-person sequential (fine at personal-CRM scale). A full assembled
  `pnpm tauri dev`/`build` launch remains pending (no GUI session this layer).

### 06 — Search, retrieval & AI
- **Scope (Plan 06):** `packages/core` —
  - `retrieval/` — the one shared `retrieve()` contract over FTS5 `content_chunks`
    (bm25 + `snippet()`, OR-recall query sanitization, recency + link-boost re-rank,
    `mode: lexical|semantic|hybrid` that degrades to lexical with `semanticAvailable:false`);
    `globalSearch()` across the six record types (FTS for documents/interactions,
    name LIKE for people/orgs/projects/tasks); pure, unit-tested `match-query`/`ranking`.
  - `domains/settings/` — typed key/value store backing the model boundary (and Plans 08+).
  - `ai/` — the BYOK model boundary: a runtime `ModelProvider` seam, `getModelStatus()`
    (provider-available **and** enabled), the single typed `assembleAnswerContext` helper +
    `citedSubset`, the cited `ask()` pipeline (persists evidence_refs per cited source on the
    assistant chat message), the model-backed `createModelExtractor()` feeding the 05a seam,
    and a concrete `createAnthropicProvider`.
  - `reports/` — agent endpoints: `getDailyBrief` (bucketed tasks + recent interactions +
    reconnects), `planDay`, `getWaitingItems`, `getChangesSince`.
  - **Desktop:** Ask rewritten to the real cited pipeline (answer + source list that opens the
    owning document/interaction; honest closed-boundary banner); the command palette upgraded
    to FTS `globalSearch`; Settings → Model shows the live boundary status; Diagnostics shows
    model + lexical/semantic availability; `installModel()` registers the provider (dev env
    key) + the extractor at startup.
- **Decision:** DEC-14 (provider seam now; key source per host later — desktop keychain in
  Plan 08, CLI env in Plan 07; degrades cleanly with no key).
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + **144 tests** (111 core: +8
  match-query, +6 ranking, +4 context, +5 extractor-json, +4 anthropic, +10 real-SQLite Plan-06
  round-trips — FTS retrieve/degrade, global search, cited Ask + persisted evidence_refs,
  kill-switch, model-backed extractor, daily brief/plan-day/changes; 4 db; 33 desktop incl. a
  new Ask closed-boundary render test). `pnpm --filter @local-brain/desktop build` ✓ (2075
  modules). `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓; `cargo test
  --workspace` ✓ (18 Rust tests, unchanged). `git diff --check` ✓.
- **Caveats:** embeddings/semantic search are an additive follow-up (lexical-only today, clean
  degradation); a stock desktop build answers only when a provider key is supplied (keychain
  wiring is Plan 08); the `brain ask`/`search` CLI path reimplements the same retrieval SQL in
  Rust in Plan 07. A full assembled `pnpm tauri dev/build` launch remains pending.

### 07 — CLI & agent skills
- **Scope (Plan 07):** the `brain` CLI grown from the foundation scaffold into the full agent
  contract, plus the agent skill and sidecar wiring.
  - **`apps/cli`** (standalone Rust, opens SQLite directly via `brain-schema` — no Tauri IPC):
    `id.rs` (dependency-free ULID matching the app's), `text.rs` (normalize/chunk/SHA-256 ports
    so CLI-written records dedupe and chunk identically to app-written ones), `db.rs` (resolve
    `--db`/`$BRAIN_DB`/default + open/migrate), `output.rs` (stdout=data, stderr=diagnostics),
    `model.rs` (BYOK boundary via `ANTHROPIC_API_KEY` + `curl`, degrades when absent), and
    `commands/` — `add document|interaction|task`, `remember`, `search`, `ask` (grounded:
    always returns cited evidence; synthesizes + persists a conversation/evidence_refs when a
    model is configured), `today`, `report daily`, `tasks plan-day`, `relationships followups`,
    `changes --since`, `graph --center self`, `show`, plus `status`/`path`/`doctor`. Stable
    `--json` camelCase contracts; typed exit codes (0/1/3/4).
  - **Sidecar:** `tauri.conf.json` gains `bundle.externalBin: ["binaries/brain"]` and the
    `beforeDev/BuildCommand` now runs `pnpm sidecar` first; the existing `build-sidecar.mjs`
    stages `brain-<triple>`. Staged + smoke-run locally.
  - **Skill:** `skills/brain/SKILL.md` (the agent-readable skill — nouns, query-before-write,
    stdout/stderr contract, write/read recipes, daily automation, what-not-to-store), registered
    in `packages/skills`. Desktop Settings → Skills shows the CLI usage + skill path.
- **Verification:** `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓; `cargo test
  --workspace` ✓ — **34 Rust tests** (4 CLI unit: ULID/normalize/hash/chunk; 10 CLI integration
  against a temp DB: status schema, dedupe, FTS search, ask-degrades-to-evidence, plan-day
  buckets, show camelCase, today/changes JSON, graph, stdout/stderr separation, no-database exit
  4; 2 skill-lint: documented commands are real + the doc covers the nouns; + 18 existing). Sidecar
  staged and the staged `brain --version` runs. `pnpm check` ✓ (144 JS tests; settings/skills
  changes typecheck); `pnpm --filter @local-brain/desktop build` ✓. `git diff --check` ✓.
- **Caveats:** `brain ask` synthesis shells out to `curl` to stay dependency-free; with no key it
  returns the cited evidence for the calling agent to reason over (it is itself the model). CLI
  retrieval is lexical (the same FTS SQL as the app, no recency re-rank, for stable snapshots).
  Sidecar *detection* in Settings + PATH install is Plan 09. A full `tauri build` was not run this
  layer (no GUI session); the sidecar staging path is verified.

### 08 — Settings, backup, export & privacy
- **Scope (Plan 08):**
  - **Rust (`src-tauri`):** `DbState::backup_to` (consistent `VACUUM INTO` snapshot → integrity
    check → atomic rename, so a crash never leaves a corrupt partial); `storage.rs`
    (`backup_database`, `write_file_atomic` for the JSON export); `keychain.rs` (provider keys via
    the macOS `security` tool — never a settings row); `database_path` command.
  - **Core (`packages/core`):** `domains/settings/model.ts` (typed model-boundary config),
    `domains/backup/` (`assembleExport` — versioned JSON over the durable tables; `createBackup`/
    `exportToFile`), `domains/maintenance/` (`hardDeleteRecord` — cascade + derived-chunk cleanup;
    `rebuildSearchIndexes` — FTS5 rebuild), `ipc/storage.ts` (typed bindings), `executeRaw` for FTS
    maintenance.
  - **Desktop:** `installModel` now reads the key from the keychain (env override for dev);
    Settings → Model is interactive (set/clear keychain key, kill-switch toggle, live status);
    Backup & export does real backup + JSON export with product states; Local database shows the
    resolved path; Diagnostics shows db path / migrations / FTS / semantic / keychain / model /
    CLI-skill + restore instructions.
- **Decision:** DEC-15 (keychain via macOS `security`; backup via `VACUUM INTO` + atomic rename;
  export is JSON interchange, backup is the restore path).
- **Verification:** `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓; `cargo test
  --workspace` ✓ — **36 Rust tests** (incl. +2 desktop: a backup that produces a restorable copy
  with no temp left behind + idempotent re-backup, and an atomic-write test). `pnpm check` ✓ —
  **155 JS tests** (119 core: +6 real-SQLite Plan-08 round-trips — export assembler/counts, hard
  delete cascade + FTS rebuild, model-settings round-trip; +4 storage IPC binding unit tests; 36
  desktop: +2 Settings render tests). `pnpm --filter @local-brain/desktop build` ✓ (2087 modules).
  `git diff --check` ✓.
- **Caveats:** keychain uses the macOS `security` CLI (launch target is macOS; non-macOS returns a
  clear error / no-op); restore is "replace the file + reopen" (a guided in-app restore is a
  follow-up); the export is JSON interchange (not a re-import path yet). A full `tauri build` was
  not run this layer.

### 09 — Packaging & launch
- **Scope (Plan 09):**
  - **Packaging smoke (strongest available on this host):** `pnpm tauri build` compiled the app and
    produced `target/release/bundle/macos/Local Brain.app` with the **`brain` sidecar embedded** at
    `Contents/MacOS/brain` (runs: `brain 0.1.0`), identity `app.localbrain.desktop` v0.1.0. Only the
    `.dmg` step failed — `bundle_dmg.sh` drives Finder via AppleScript and needs a GUI/login session
    (documented; the `.app` is the runnable artifact, produce the DMG on a dev workstation).
  - **First-run flow:** a one-time welcome overlay (tracked by a `firstRun.completed` settings flag)
    confirming where the data lives, the honest model-boundary status, and how to start (add a record
    / set a key / use the CLI).
  - **Accessibility:** a visible keyboard `:focus-visible` ring on all interactive elements and a
    `prefers-reduced-motion` block in `globals.css`.
  - **Launch docs:** `docs/launch/README.md` (install, storage, importing, Codex, backup/export,
    model boundaries, troubleshooting) and `docs/launch/checklist.md` (packaging status, first-run
    smoke checklist, accessibility/performance/privacy gates, signing/notarization checklist,
    update-path decision).
- **Verification:** `pnpm tauri build` → `.app` + embedded runnable sidecar ✓ (`.dmg` step
  GUI-blocked, documented). `pnpm check` ✓ — **161 JS tests** (119 core; 4 db; 38 desktop: +1
  Settings, +2 first-run render tests over the prior layer). `pnpm --filter @local-brain/desktop
  build` ✓. `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓; `cargo test --workspace` ✓
  (36 tests). `git diff --check` ✓.
- **Caveats:** DMG bundling + signing/notarization need a developer workstation (unsigned alpha
  supported, checklist provided); a manual VoiceOver pass and on-device performance measurement are
  recommended before public alpha; the GUI app was not launched headless (no window server) — the
  compile + bundle + embedded-sidecar run is the smoke.

## Open / Updated PR URLs

- PR #1 — Build 00 supervisor docs — https://github.com/maccman/local-brain/pull/1 (base `master`, open)
- PR #2 — Build 01 foundation scaffold — https://github.com/maccman/local-brain/pull/2 (base `…-00-supervisor`, open)
- PR #3 — Build 02a launch schema — https://github.com/maccman/local-brain/pull/3 (base `…-01-foundation`, open)
- PR #4 — Build 02b db package (Kysely codegen + drift check) — https://github.com/maccman/local-brain/pull/4 (base `…-02a-schema`, open)
- PR #5 — Build 02c Rust IPC DB bridge — https://github.com/maccman/local-brain/pull/5 (base `…-02b-db`, open)
- PR #6 — Build 02d core DB actions + seed — https://github.com/maccman/local-brain/pull/6 (base `…-02c-bridge`, open)
- PR #7 — Build 03a desktop shell (routing, commands, core surfaces) — https://github.com/maccman/local-brain/pull/7 (base `…-02d-core-db`, open)
- PR #8 — Build 03b desktop shell II (Graph, Ask, Settings, org browsing, detail richness, palette search) — https://github.com/maccman/local-brain/pull/8 (base `…-03-desktop-shell`, open)
- PR #9 — Build 04a ingestion core engine (chunking, hashing, ingest + links + dedupe) — https://github.com/maccman/local-brain/pull/9 (base `…-03b-desktop-shell-ii`, open)
- PR #10 — Build 04b Rust file-read primitives (safe reads, size caps, hashing, folder enum) — https://github.com/maccman/local-brain/pull/10 (base `…-04a-ingestion-core`, open)
- PR #11 — Build 04c ingestion UI (paste/import dialog, folder import, Add actions) — https://github.com/maccman/local-brain/pull/11 (base `…-04b-ingestion-fs`, open)
- PR #12 — Build 05a extraction engine (contracts, preprocessing, merge/apply, model seam) — https://github.com/maccman/local-brain/pull/12 (base `…-04c-ingestion-ui`, open)
- PR #14 — Build 05b extraction corrections + relationship intelligence — https://github.com/maccman/local-brain/pull/14 (base `…-05a-extraction-engine`, open)
- PR #15 — Build 06 search, retrieval & AI (FTS5 retrieve, cited Ask, model boundary, model-backed extractor, report endpoints) — https://github.com/maccman/local-brain/pull/15 (base `…-05b-corrections`, open)
- PR #16 — Build 07 CLI & agent skills (`brain` CLI add/search/ask/today/report/graph/show, JSON contracts, sidecar bundling, skill doc) — https://github.com/maccman/local-brain/pull/16 (base `…-06-search-ai`, open)
- PR #17 — Build 08 settings, backup, export & privacy (SQLite backup, JSON export, keychain, model boundary settings, hard delete + FTS rebuild) — https://github.com/maccman/local-brain/pull/17 (base `…-07-cli-skills`, open)
- PR #19 — Build 09 packaging & launch (macOS `.app` + embedded sidecar smoke, first-run flow, accessibility, launch docs + checklist) — https://github.com/maccman/local-brain/pull/19 (base `…-08-settings-backup-privacy`, open)
