# Build Status

Live status log for the Local Brain implementation. Newest entries at the top.
The build supervisor updates this after every significant phase. See
[manifest.md](manifest.md) for the PR stack and [decisions.md](decisions.md) for
questions needing Alex.

## Current State

- **Phase:** 09 — Packaging & launch (**complete, PR #19 open**). **All Plans 00–09 are now
  built and open as a stacked set of PRs: #1–#12, #14–#17, #19 (the standalone mega PR #13 and the
  unrelated #18 are not part of this stack).** Plan 09 ran the
  strongest available packaging smoke: `pnpm tauri build` compiled and produced
  `Local Brain.app` with the `brain` sidecar embedded and runnable (`brain 0.1.0`); only the `.dmg`
  step is GUI-blocked (documented). Added a one-time first-run welcome flow, a keyboard focus ring +
  reduced-motion accessibility pass, and the launch docs (`docs/launch/README.md` + `checklist.md`).
  **161 JS tests**, **36 Rust tests**, desktop build, all green. **Build complete.**
- **Active branch:** `codex/local-brain-09-packaging-launch` (base `…-08-settings-backup-privacy`).
- **Blockers:** none. Remaining for public release (documented, not blocking the alpha): DMG
  bundling + signing/notarization on a developer workstation, a manual VoiceOver pass, on-device
  performance measurement. The GUI app was not launched headless (no window server); the compile +
  bundle + embedded-sidecar run is the smoke.

### Prior phase (08)

- **Phase:** 08 — Settings, backup, export & privacy (**complete, PR #17 open**). SQLite backup
  (`VACUUM INTO` → integrity check → atomic rename), JSON export (versioned, atomic), provider keys
  in the macOS keychain (the desktop registers the model provider from it at startup, completing
  DEC-14), an interactive Settings → Model boundary (set/clear key, live status),
  hard-delete with cascade + derived-chunk cleanup + FTS rebuild, and richer Diagnostics (db path /
  migrations / FTS / semantic / keychain / model / CLI-skill + restore instructions). **36 Rust
  tests**, **155 JS tests**, desktop build — all green. **Plan 08 complete.** Stack continues to
  Plan 09 (packaging & launch). See DEC-15.
- **Active branch:** `codex/local-brain-08-settings-backup-privacy` (base `…-07-cli-skills`).
- **Blockers:** none. Keychain uses the macOS `security` CLI (launch target is macOS); restore is
  "replace the file + reopen"; JSON export is interchange, not yet a re-import path.

### Prior phase (07)

- **Phase:** 07 — CLI & agent skills (**complete, PR #16 open**). The `brain` CLI grew from the
  Plan 01 scaffold into the full agent contract: a standalone Rust binary that opens SQLite
  directly (no Tauri IPC), with `add document|interaction|task`, `remember`, `search`, `ask`
  (grounded — always returns cited evidence; synthesizes + persists when a model is configured),
  `today`, `report daily`, `tasks plan-day`, `relationships followups`, `changes`, `graph`,
  `show`, and `status/path/doctor`. Stable `--json` camelCase, typed exit codes, stdout=data /
  stderr=diagnostics. ULID + normalize/chunk/SHA-256 ports keep CLI writes byte-compatible with
  app writes. Sidecar wired (`bundle.externalBin` + `pnpm sidecar` before dev/build) and staged.
  Agent skill authored at `skills/brain/SKILL.md` and registered; Settings → Skills updated.
  **34 Rust tests** green (incl. 12 CLI integration + skill-lint), `pnpm check` 144 green, desktop
  build green. **Plan 07 complete.** Stack continues to Plan 08 (settings/backup/privacy).
- **Active branch:** `codex/local-brain-07-cli-skills` (base `…-06-search-ai`).
- **Blockers:** none. `brain ask` synthesis uses `curl` (dependency-free) and degrades to
  evidence-only without a key; sidecar *detection* in Settings + PATH install is Plan 09.

### Prior phase (06)

- **Phase:** 06 — Search, retrieval & AI (**complete, PR #15 open**). Built the one shared
  FTS5 `retrieve()` contract + `globalSearch()`, the BYOK model boundary (`ModelProvider` seam,
  checked `getModelStatus()`, the single typed `assembleAnswerContext` helper), the cited
  `ask()` pipeline (persists `evidence_refs` per cited source), the model-backed
  `createModelExtractor()` feeding the 05a seam, a concrete Anthropic provider, and the agent
  report endpoints (`getDailyBrief`/`planDay`/`getWaitingItems`/`getChangesSince`). Desktop: Ask
  rewritten to real cited answers with source-opening citations + honest closed-boundary banner;
  palette upgraded to FTS; Settings → Model + Diagnostics show live boundary/search status.
  `pnpm check` green (**144 tests**), Vite build green, cargo gates green. **Plan 06 complete.**
  Stack continues to Plan 07 (CLI + skills) on top of `…-06-search-ai`. See DEC-14.
- **Active branch:** `codex/local-brain-06-search-ai` (base `…-05b-corrections`).
- **Blockers:** none. Embeddings/semantic deferred (clean lexical fallback); live desktop model
  answers need a provider key (keychain wiring is Plan 08); CLI Ask/search reimplements
  retrieval SQL in Rust in Plan 07.

### Prior phase (05b)

- **Phase:** 05b — Extraction corrections + relationship intelligence: the deterministic
  second half of Plan 05 (steps 8–9), which **completes Plan 05**. Correction setters in
  `packages/core` (memories: `updateMemory`/`archiveMemory`/`unlink|linkMemoryToRecord`;
  typed links: one undirected `unlinkRecords` over a 15-relation registry; evidence:
  `updateEvidenceRef`/`removeEvidenceRef`) plus relationship-intelligence recompute
  (`relationships/`: pure `strength.ts`, `recompute.ts` deriving last-interaction/reconnect/
  strength from interactions+tasks, `listReconnectSuggestions`). Recompute runs after a
  relevant interaction (create/ingest/apply) and on first-run seed. The shared detail-page
  components gained in-place Unlink/Archive/Remove affordances; Today gained a **Reconnect**
  section. No model behavior; all derivation is a deterministic projection (DEC-13).
  `pnpm check` (109 tests) + Vite build green, PR open. **Plan 05 complete** (05a + 05b);
  Plan 06 registers the model-backed extractor through the BYOK boundary.
- **Active branch:** `codex/local-brain-05b-corrections` (base `…-05a-extraction-engine`).
- **Mode:** Sequential. This session builds the stack layer by layer; no parallel
  worker sessions are spawned. (Within a layer, read-only research may fan out, but
  commits are made sequentially from this session.)
- **Blockers:** none at this checkpoint.

## Log

### 2026-06-17 — Phase 09: Packaging & launch (Plan 09 complete — build complete)
- **Packaging smoke (strongest available on this host):** `pnpm tauri build` compiled the release
  app and produced `target/release/bundle/macos/Local Brain.app` with the **`brain` sidecar embedded**
  at `Contents/MacOS/brain` (verified: runs `brain 0.1.0`), bundle id `app.localbrain.desktop`
  v0.1.0. The `.dmg` step failed because `bundle_dmg.sh` drives Finder via AppleScript and needs a
  GUI/login session — documented; the `.app` + embedded sidecar is the runnable artifact.
- **First-run flow:** `components/first-run.tsx` — a one-time welcome overlay (gated by a
  `firstRun.completed` settings flag) confirming the data location, the honest model-boundary status,
  and how to start; wired into `AppShell`.
- **Accessibility:** `globals.css` gains a keyboard-only `:focus-visible` ring on all interactive
  elements and a `prefers-reduced-motion` block.
- **Launch docs:** `docs/launch/README.md` (install, local storage, importing, Codex, backup/export,
  model boundaries, troubleshooting) and `docs/launch/checklist.md` (packaging status table,
  first-run smoke checklist, accessibility/performance/privacy gates, signing/notarization checklist,
  update-path decision).
- **Verification:** `pnpm tauri build` → `.app` + runnable embedded sidecar ✓ (`.dmg` GUI-blocked,
  documented). `pnpm check` ✓ — **161 JS tests** (119 core; 4 db; 38 desktop incl. +2 first-run
  render tests). `pnpm --filter @local-brain/desktop build` ✓. `cargo fmt --all -- --check` ✓;
  `cargo check --workspace` ✓; `cargo test --workspace` ✓ (36 tests). `git diff --check` ✓.

### 2026-06-17 — Phase 08: Settings, backup, export & privacy (Plan 08 complete)
- **Rust (`src-tauri`):** `DbState::backup_to` (consistent `VACUUM INTO` snapshot → integrity check
  → atomic rename); `storage.rs` (`backup_database`, `write_file_atomic`); `keychain.rs` (provider
  keys via the macOS `security` tool); `database_path` command. All registered in `lib.rs`.
- **Core (`packages/core`):** `domains/settings/model.ts` (typed model config), `domains/backup/`
  (`assembleExport` — versioned JSON over the durable tables; `createBackup`/`exportToFile`),
  `domains/maintenance/` (`hardDeleteRecord` — cascade + content-chunk cleanup; `rebuildSearchIndexes`
  — FTS5 rebuild), `ipc/storage.ts` bindings, `executeRaw`.
- **Desktop:** `installModel` reads the key from the keychain (env override for dev) and registers
  the provider; Settings → Model is interactive (set/clear key, live status);
  Backup & export performs real backup + JSON export with product states; Local database shows the
  resolved path; Diagnostics shows db path / migrations / FTS / semantic / keychain / model /
  CLI-skill + restore instructions.
- **Decision DEC-15:** keychain via macOS `security`; backup via `VACUUM INTO` + atomic rename;
  backup is the restore path, JSON export is interchange; hard delete cleans derived data.
- **Verification:** `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓; `cargo test
  --workspace` ✓ — **36 Rust tests** (+2 desktop: restorable backup w/ no temp leftover + atomic
  write). `pnpm check` ✓ — **155 JS tests** (119 core incl. +6 Plan-08 real-SQLite + 4 storage IPC
  unit; 36 desktop incl. +2 Settings render). `pnpm --filter @local-brain/desktop build` ✓ (2087
  modules). `git diff --check` ✓.

### 2026-06-17 — Phase 07: CLI & agent skills (Plan 07 complete)
- **`apps/cli` (`brain`)** grew from the Plan 01 scaffold into the full agent contract — a
  standalone Rust binary opening SQLite directly via `brain-schema` (no Tauri IPC), so it runs
  with the app closed and at the same migration version.
  - **Ports for write parity:** `id.rs` (dependency-free ULID, Crockford base32, 26 chars),
    `text.rs` (normalize/paragraph-chunk/SHA-256 — faithful ports of the core ingest so a
    CLI-added note dedupes against and chunks identically to an app-added one).
  - **Commands:** `add document|interaction|task` (record + chunks + links in one transaction),
    `remember` (memory + memory_links), `search` (FTS over docs/interactions + name LIKE),
    `ask` (grounded — retrieves cited chunks; with `ANTHROPIC_API_KEY` synthesizes via `curl` and
    persists a conversation + evidence_refs; without, returns `answered:false` + evidence for the
    calling agent), `today`/`report daily`/`tasks plan-day`/`relationships followups`/`changes`/
    `graph --center self`/`show`, plus `status`/`path`/`doctor`. Stable `--json` camelCase, typed
    exit codes (0/1/3/4), stdout=data / stderr=diagnostics.
  - **Model boundary:** `model.rs` — key from `ANTHROPIC_API_KEY` (never settings), HTTP via
    `curl` to stay dependency-free; degrades cleanly when absent. Mirrors the app's checked seam.
- **Sidecar:** `tauri.conf.json` gains `bundle.externalBin: ["binaries/brain"]`; `beforeDev/Build`
  runs `pnpm sidecar` first; staged `brain-aarch64-apple-darwin` runs (`--version` ✓).
- **Skill:** `skills/brain/SKILL.md` (nouns, query-before-write, stdout/stderr contract, write/read
  recipes, daily automation, what-not-to-store), registered in `packages/skills`; Settings → Skills
  shows usage + the skill path.
- **Verification:** `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓; `cargo test
  --workspace` ✓ — **34 Rust tests** (4 CLI unit + 10 CLI integration over a temp DB + 2 skill-lint
  + 18 existing). `pnpm check` ✓ (144 JS tests); `pnpm --filter @local-brain/desktop build` ✓;
  sidecar staged + smoke-run; `git diff --check` ✓.

### 2026-06-17 — Phase 06: Search, retrieval & AI (Plan 06 complete)
- **Retrieval (`packages/core/src/retrieval`):** one shared `retrieve()` over FTS5
  `content_chunks` (bm25 + `snippet()`; OR-recall sanitization so question stopwords don't gate;
  recency + explicit-link re-rank; `mode` accepts lexical/semantic/hybrid and degrades to lexical
  with `semanticAvailable:false`). `globalSearch()` spans the six record types (FTS for
  documents/interactions, name LIKE for the rest). Pure `match-query`/`ranking` unit-tested.
- **Model boundary (`packages/core/src/ai`):** a runtime `ModelProvider` seam (`setModelProvider`),
  `getModelStatus()` gating on *both* a present/available provider and the external-calls setting,
  the single typed `assembleAnswerContext` + `citedSubset` (all external context flows through it),
  the cited `ask()` pipeline (retrieve → assemble → generate → persist answer + one `evidence_refs`
  per cited source on the assistant message; honest "not configured" turn when the boundary is
  closed, `answered:false`), the model-backed `createModelExtractor()` (prompts the contract,
  parses JSON, feeds the 05a apply seam), and a concrete `createAnthropicProvider`.
- **Reports (`packages/core/src/reports`):** `getDailyBrief` (bucketed overdue/today/soon/open
  tasks + recent interactions + reconnects + counts), `planDay`, `getWaitingItems`,
  `getChangesSince`.
- **Settings store (`packages/core/src/domains/settings`):** typed key/value over the `settings`
  table (`getSetting`/`setSetting`/`listSettings`) for provider and app settings.
- **Desktop:** Ask rewritten to the real cited pipeline — answers render with a numbered source
  list that opens the owning document/interaction, model id shown, and a closed-boundary banner;
  the command palette now uses FTS `globalSearch`; Settings → Model shows the live boundary status;
  Diagnostics shows model + lexical(FTS5)/semantic status; `installModel()` registers the provider
  (optional `VITE_ANTHROPIC_API_KEY` dev key) and the extractor at startup.
- **Decision DEC-14:** provider seam now; key source per host later (desktop keychain in Plan 08,
  CLI env in Plan 07). No heuristic faking — the boundary is exercised with a mock provider.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint (clean) + **144 tests** (111 core: +8
  match-query, +6 ranking, +4 context, +5 extractor-json, +4 anthropic, +10 real-SQLite Plan-06
  round-trips; 4 db; 33 desktop incl. a new Ask closed-boundary render test + the palette switched
  to global search). `pnpm --filter @local-brain/desktop build` ✓ (2075 modules). `cargo fmt
  --all -- --check` ✓; `cargo check --workspace` ✓; `cargo test --workspace` ✓ (18 tests).
  `git diff --check` ✓.

### 2026-06-17 — Phase 05b: Extraction corrections + relationship intelligence (Plan 05 complete)
- Built the deterministic second half of Plan 05 (steps 8–9). **No model**; everything is a
  projection or a typed correction over the canonical SQLite store.
- **Correction setters (`packages/core`):**
  - memories: `updateMemory`, `archiveMemory` (soft-delete), `unlinkMemoryFromRecord` /
    `linkMemoryToRecord`.
  - typed record links: `unlinkRecords(a, b)` — one **undirected, order-independent** setter
    over a 15-relation registry (every join surfaced on the detail pages, plus the two
    non-join cases: person↔org `affiliations` and project↔task `tasks.project_id`). Each maps
    to a single delete/clearing update, so the write is inherently atomic.
  - evidence: `updateEvidenceRef` (repoint chunk / fix span / edit note), `removeEvidenceRef`.
- **Relationship intelligence (`packages/core/src/domains/relationships`):**
  - `strength.ts` — pure date math (`daysBetween`/`addDays`) + a transparent 1–5
    `relationshipStrength` (frequency + recency + shared open tasks), returning `null` when
    there is no signal so manual values survive.
  - `recompute.ts` — `recomputeRelationshipIntelligence` derives `last_interaction_at`,
    `next_reconnect_at`, and `relationship_strength` from interactions/tasks;
    `recomputeAllRelationships` for bulk/first-run. Wired to run after a relevant interaction
    (`createInteraction`, `ingestInteraction`, and `applyExtraction` on an interaction source).
  - `getters.ts` — `listReconnectSuggestions` reads the derived `next_reconnect_at` column.
  - **DEC-13:** strength is recompute-owned (written only with a signal); `reconnect_interval_days`
    stays a user input; `important_dates_json` is **not** derived (no schema field supplies
    dates) — left for a later data source, as Plan 05 step 9 permits.
- **UI (`apps/desktop`):** shared `LinkedRecords` / `MemoryList` / `CitationList` gained
  Unlink / Archive / Remove affordances, wired through all six detail pages (incl. interaction
  participants); person detail shows the derived "Reconnect by"; Today gained a **Reconnect**
  section. New hooks `useUnlinkFrom`/`useUnlinkRecord`/`useArchiveMemory`/`useUnlinkMemory`/
  `useRemoveEvidenceRef`/`useReconnectSuggestions` invalidate broadly; `useEnsureSeed`
  recomputes after first-run seed. The seed's kickoff interaction date was moved earlier so
  the demo shows a real overdue reconnect.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint (clean) + **109 tests** (72 core:
  +7 `strength` unit tests, +10 real-SQLite corrections/recompute round-trips — unlink an
  affiliation / a task↔project / a document link, edit+unlink+archive a memory, fix+remove a
  citation, derive last-interaction/reconnect/strength, count shared open tasks, preserve a
  no-signal manual strength, ordered reconnect suggestions, and the not-due/no-cadence case;
  4 db; 33 desktop: +2 correction-affordance render tests, +1 Today reconnect render test).
  `pnpm --filter @local-brain/desktop build` ✓ (2057 modules). No Rust this layer. `git diff
  --check` ✓.

### 2026-06-17 — Phase 05a: Extraction engine (deterministic half of Plan 05)
- **Sequencing decision (DEC-12):** Plan 05's only model-dependent step (step 3, "build
  model extraction") needs the Plan 06 BYOK model boundary; faking it with heuristics was
  out of bounds. So this layer builds the deterministic engine *around* an explicit typed
  model seam and defers the model-backed extractor to Plan 06. Plan 05 split into **05a**
  (this — contracts/preprocessing/matching/apply/seam) and **05b** (correction flows +
  relationship intelligence). Downstream bases shift to `…-05a-…` then `…-05b-…`.
- Built `packages/core/src/extraction`:
  - `contracts.ts` — zod schemas + types for the extraction **output contract** (people,
    orgs, affiliations, projects, tasks, memories, evidence; entities linked by local
    `ref`s), `parseExtractionResult`, and `validateExtraction` (ref uniqueness + resolvable,
    correctly-typed references).
  - `preprocess.ts` — deterministic `findDates`/`findEmails`/`selectChunks` and
    `buildExtractionContext` (source chunks + hints + known participants + dedupe
    candidates) that assembles a model's input without calling a model.
  - `match.ts` — `normalizeName`/`normalizeEmail`/`normalizeDomain` and
    `matchPerson`/`matchOrganization`/`matchProject` (exact key first, then normalized name).
  - `apply.ts` + `apply-store.ts` — `applyExtraction`: resolve each ref to an
    existing-or-new row (merge/upsert), write new records, link them to the source, create
    hidden memories with `memory_links`, and attach `evidence_refs` to chunks, all in one
    `db_batch`. Confidence gating (`minConfidence`) yields suggestions instead of writes;
    obvious dups skipped; unresolved evidence/links reported. (Split into two files to keep
    each under the 500-line lint ceiling.)
  - `extractor.ts` — the typed `Extractor` seam, `runExtraction`, and
    `installExtractionPipeline` (fire-and-forget ingest-queue handler). No extractor is
    registered by default, so the pipeline is a safe no-op until Plan 06 supplies a
    model-backed adapter.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + **91 tests**
  (55 core: 11 match + 5 preprocess + 6 contracts unit tests + 6 real-SQLite golden
  apply tests — a meeting transcript creating people/org/project/task and a cited hidden
  memory with evidence resolved to source chunks; merge/upsert onto an existing person +
  idempotent re-apply; confidence-gated suggestions; **dependent gating** (a task whose
  person/project ref was gated out, and a memory whose subject ref was gated out, are held
  back as suggestions rather than written partial); and the extractor seam running only
  when registered; 4 db; 30 desktop unchanged). `pnpm --filter @local-brain/desktop build`
  ✓ (2051 modules). `cargo check --workspace` ✓ (no Rust this layer). `git diff --check` ✓.
  Lint is clean — no warnings. (The real-SQLite apply tests live in their own focused
  `extraction.test.mjs` sibling, sharing the in-memory bridge via `sqlite-harness.mjs`, so
  the integration test file stays under the 500-line ceiling.)

### 2026-06-17 — Phase 04c: Ingestion UI (Plan 04 complete)
- Built `AddRecordDialog`: a Document/Interaction toggle and a Paste/Import-folder mode
  toggle. Paste mode has title/kind/date, a body textarea, an optional "load from file path"
  (calls `readTextFile`), and collapsible people/projects/organizations/tasks link pickers;
  Save runs `ingestDocument`/`ingestInteraction`, shows the duplicate notice, and navigates
  to the record. Folder mode scans a path with `readTextFolder` then ingests each file,
  reporting imported/duplicate/skipped counts.
- Wired it in: added `openAdd` to `CommandContext`, pointed the `new.document` /
  `new.interaction` palette commands at it, added an **Add** button to the command bar, and
  gave `AppShell` the dialog state. Added `useIngestDocument` / `useIngestInteraction`
  mutations (broad invalidation).
- **Decision (DEC-11):** file/folder selection is a typed **path field**, not a native
  picker — keeps the build hermetic and the dialog render-testable without the Tauri dialog
  plugin; the native picker is a follow-up.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + **61 tests** (27 core, 4 db, 30
  desktop incl. 4 new `AddRecordDialog` render tests). `pnpm --filter @local-brain/desktop
  build` ✓ (2041 modules). `cargo check --workspace` ✓ (no Rust this layer). `git diff
  --check` ✓.

### 2026-06-17 — Phase 04b: Rust safe file-read primitives
- Built `apps/desktop/src-tauri/src/fs.rs`: `read_text_file` (canonicalize the
  user-selected path, require a regular file, 5 MiB size cap, require valid UTF-8, detect
  kind by extension, SHA-256 the bytes, clear typed errors otherwise) and `read_text_folder`
  (recursive scan that skips hidden / unsupported / oversized / binary / duplicate files and
  anything resolving outside the chosen root via a symlink, returning per-file skip reasons +
  imported/skipped counts). Registered both commands in `lib.rs`; added `sha2` to the
  workspace; added typed `readTextFile`/`readTextFolder` zod bindings in
  `packages/core/src/ipc/fs.ts`.
- **Hashing:** the Rust hash is SHA-256 over the file's raw UTF-8 bytes (intra-scan dup
  flagging only); the authoritative cross-record dedupe hash stays the 04a one, computed at
  ingest over normalized text, so 04c will pass `contents` through `ingestDocument`.
- **Verification:** `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓;
  `cargo test --workspace` ✓ — 12 tests (3 new `fs` tests + 9 existing); `pnpm check` ✓
  (the new bindings typecheck; 57 JS tests unchanged); `git diff --check` ✓.

### 2026-06-17 — Phase 04a: Ingestion core engine (Plan 04 split)
- Split Plan 04 into **04a** (this PR — the TS ingestion engine), **04b** (Rust safe
  file-read primitives), and **04c** (ingestion UI), recorded as DEC-10; shifted Plan 05's
  base to `…-04c-ingestion-ui`.
- Built `packages/core/src/ingest`: `normalizeText` + paragraph-aware `chunkText` (pure,
  unit-tested); `contentHash` (SHA-256 hex via Web Crypto, matching the future Rust `sha2`
  path so pasted and imported copies dedupe); `ingestDocument` / `ingestInteraction` that
  normalize → hash → dedupe-check → write the record + `content_chunks` + optional
  people/orgs/projects/tasks links in one `db_batch`; and an `extraction-queue` seam
  (`markForExtraction`/`setExtractionHandler`, no-op until Plan 05 step 10).
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + **57 tests** (27 core incl. 6
  chunk/normalize unit tests + a new real-SQLite ingestion block: normalized body + chunks
  + content hash + links, duplicate detection + `allowDuplicate`, interaction participant
  links, atomic rollback on an invalid link FK; 4 db; 26 desktop). `cargo check --workspace`
  ✓ (no Rust this layer). `git diff --check` ✓.

### 2026-06-17 — Phase 03b: Desktop shell II (Plan 03 complete)
- Built the 03b read getters in `@local-brain/core` (all over the existing `db_query`
  bridge — no Rust changes): organizations getters/setters; a `relations` module that
  returns each record's typed join-table neighborhood as navigable `LinkedRecord`s;
  memories (`listMemoriesForRecord`); citations/evidence (`listCitationsForSubject`,
  `listEvidenceFromDocument`); chat conversations/messages (getters + `createConversation`
  / `addMessage` that writes the message and touches the conversation in one batch); a
  user-centered `getGraph` assembler (self-hub + join-table edges, per-kind node caps with
  `truncatedKinds`); and a `quickSearch` LIKE getter for the palette.
- Built the surfaces: an SVG **Graph** (a pure, unit-tested `graph-layout` radial layout,
  click-to-navigate nodes, a kind legend, and a truncation note); the **Ask** chat shell
  (conversation list + thread + composer; persists a clearly-labeled Plan-06 placeholder
  answer — DEC-8); full **Settings** sections wired to the `settings.section` route param;
  the **Network → Organizations** tab + organization detail; richer
  **person/org/project/task/document/interaction** detail pages with shared `LinkedRecords`,
  `CitationList`, and `MemoryList` components; and a command palette with live record search
  + arrow-key navigation (kept hand-rolled instead of pulling in `cmdk` — DEC-7). Coalesced
  the single-record query hooks to `null` so TanStack Query never sees `undefined` data.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + **47 tests** (17 core incl. a new
  real-SQLite round-trip block over the seed: organizations, person links, memories +
  citations, graph assembly, chat threads, quick-search; 4 db; 26 desktop incl. the
  `graph-layout` unit tests and jsdom/Testing-Library render tests for `RouteContent`, the
  palette record search + keyboard nav, and `LinkedRecords` — DEC-9). `pnpm --filter
  @local-brain/desktop build` ✓ (Vite bundles 2039 modules). `cargo check --workspace` ✓
  (unchanged — no Rust this layer). `git diff --check` ✓. A full assembled `pnpm tauri
  dev`/`build` launch was not run (no GUI session); still pending.

### 2026-06-17 — Stack hygiene: propagate foundation fixes down
- The parent's `6abc16c` ("Verify Rust workspace") mixed three layers. Split it so
  each PR reviews cleanly and compiles standalone: the foundation-only changes
  (`Cargo.lock`, the placeholder Tauri icon set, the `gen/schemas/` ignore, and the
  `cargo fmt` of the app crates) moved down to **#2** as `a11800d`; **#3** was
  rebuilt on top so it carries only the schema work (`0002` migration + tests). #3's
  tree is byte-identical to the previously-verified `6abc16c` (asserted with
  `git diff backup/02a-schema …`). Backup tags kept for every original branch tip.
- Re-verified both branches: **#2** `pnpm check` ✓, `cargo fmt --all -- --check` ✓,
  `cargo check --workspace` ✓, `cargo test --workspace` ✓ (5 brain-schema tests);
  **#3** the same plus 9 brain-schema tests. Pushed (#2 fast-forward, #3
  force-with-lease) and left explanatory PR comments.

### 2026-06-17 — Phase 03a: Desktop shell (routing, commands, core surfaces)
- Split Plan 03 into **03a** (this PR — the shell skeleton + data-backed core surfaces)
  and **03b** (Graph, Ask, full Settings, org browsing, richer detail, cmdk palette);
  recorded as DEC-5. Subsequent layer bases shifted to `…-03b-…`.
- Built the typed routing layer: a discriminated-union `Route` with URL serialize/parse
  (`routing/route.ts`) and an in-memory history router with back/forward synced to
  `window.history` (`routing/router.tsx`). Added a central command/keymap registry with
  a duplicate-id guard, `Mod-…` keybinding parsing/matching, global shortcuts, and a
  minimal command palette (`lib/commands/*`).
- Built the app shell (collapsible sidebar over the seven sections, a top command bar
  with back/forward + ⌘K, and the route switch) and shared primitives (page head, dense
  data list, section, detail fields, empty state). Wired the **Today, Tasks (status
  filter + inline complete/archive), Network→People, and Projects** surfaces plus
  **person/project/task/document/interaction** detail pages to the `@local-brain/core`
  getters/setters through TanStack Query, with seed-on-first-run. Graph, Ask, Settings,
  and Organizations are placeholders for 03b.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + 11 desktop tests (route
  serialize/parse round-trips for every route kind; command registry + the
  duplicate-keybinding guard the plan calls for). `pnpm --filter @local-brain/desktop
  build` ✓ (Vite bundles 2025 modules). `cargo check --workspace` ✓. `git diff --check`
  ✓.

### 2026-06-17 — Phase 02d: Core DB actions + seed (Plan 02 complete)
- Built the TypeScript domain layer in `packages/core`: a shared Kysely client over
  the bridge (`db/client.ts`); `execute`/`batch` write bindings that `.compile()` a
  Kysely insert/update and send the SQL to `db_execute`/`db_batch` so Rust owns the
  transaction (`db/commands.ts`); ULID id generation (`db/id.ts`); and getters/setters
  for people, projects, tasks, documents, interactions. `createInteraction` writes the
  interaction and its participant links in a single `batch` (multi-table, atomic).
- Added `seedDemoData()`: an idempotent, single-transaction insert of a coherent demo
  dataset — self + two people, an organization + affiliation, a project, two tasks, a
  meeting with a participant, a document + derived content chunk, a memory linked to a
  person, an evidence citation into that chunk, and a tag.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + 11 core tests. Two layers of
  testing: a typechecked capturing-bridge unit test (asserts each action compiles the
  right SQL/params) and a `node:sqlite`-backed integration test (`.test.mjs`) that runs
  the real getters/setters and seed against the actual migrations — create→read→
  complete→archive across domains, idempotent seed, and an atomic batch rollback when a
  participant FK is invalid. No native deps (built-in `node:sqlite`).

### 2026-06-17 — Phase 02c: Rust IPC DB bridge
- Split the original Plan-02c (Rust IPC + core actions + seed) into **02c** (the Rust
  bridge, cargo-verified) and **02d** (the TypeScript domain layer + seed,
  `pnpm check`-verified) so each PR is one language/concern. Recorded in
  [manifest.md](manifest.md) and [decisions.md](decisions.md) (DEC-2); shifted the
  bases of layers 03–09 up by one.
- Built `apps/desktop/src-tauri/src/db`: a managed `DbState` (the single durable
  `rusqlite::Connection` behind a `Mutex`); `db_query` runs read-only statements only
  (rejects anything `!stmt.readonly()`), `db_execute` runs one write, and `db_batch`
  runs every statement inside one transaction that rolls back on any error. Added
  JSON↔SQLite param/row conversion (scalars map directly; arrays/objects round-trip as
  JSON text for `json()` columns) and `From<rusqlite::Error>`/`From<SchemaError>` for
  `AppError`. `lib.rs` now opens + migrates the database at startup (path resolved like
  the CLI: `$BRAIN_DB` → platform data dir) and registers the three commands; the
  desktop's Kysely runner already targets `db_query`.
- **Verification:** `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓;
  `cargo test --workspace` ✓ — 6 new desktop bridge tests (execute+query round-trip,
  read-path write rejection, NULL serialization, JSON-param round-trip, atomic batch
  commit, batch rollback on a FK violation) plus 9 brain-schema tests; `git diff
  --check` ✓; `pnpm check` ✓ (unaffected).

### 2026-06-17 — Phase 02b: DB package (Kysely codegen + drift check)
- Authored `packages/db/scripts/generate-schema.mjs`: replays the
  `crates/brain-schema` migrations into an in-memory database via Node's built-in
  `node:sqlite` (chosen over `better-sqlite3` + `kysely-codegen` to avoid a native
  build on Node 26) and introspects `PRAGMA table_info` to emit `src/schema.gen.ts`
  — the `Database` interface plus a row type for each of the 33 durable + join
  tables, camelCase columns, `Generated<T>` for defaulted/`DEFAULT` columns, and
  `… | null` for nullable columns. FTS5 virtual/shadow tables are excluded (search
  uses raw SQL, Plan 06).
- `src/schema.ts` now re-exports the generated types; `src/index.ts` re-exports the
  full schema. Added `scripts/check-drift.mjs`, wired into the db package's `test`
  script, which regenerates and diffs against the committed file (proven: exit 1 on
  a stale file, exit 0 when current).
- Added a dialect test that drives the generated `people` types end-to-end
  (`fullName`→`full_name`, `isSelf`→`is_self`, etc.) through the CamelCasePlugin.
- **Verification:** `pnpm check` ✓ — typecheck + oxlint + db drift check + 4 db
  vitest tests (and the existing core tests). No new dependencies.

### 2026-06-17 — Phase 02a: SQLite schema crate
- Parent review installed the Homebrew Rust toolchain (`cargo 1.96.0`, `rustc
  1.96.0`), added the missing placeholder Tauri icon set required by
  `tauri::generate_context!()`, formatted Rust sources, and verified:
  `cargo fmt --all -- --check` ✓; `cargo check --workspace` ✓; `cargo test
  --workspace` ✓ (including 9 `brain-schema` tests).
- Authored `crates/brain-schema/migrations/0002_launch_schema.sql`: the full
  launch schema from docs/launch-schema.md — 16 durable tables + 16 typed join
  tables, 25 filter indexes (incl. a partial unique index for the single self
  person row), enum CHECK constraints on polymorphic `record_type`/`subject_type`
  columns, and FTS5 (external-content + sync triggers) over documents,
  interactions, and content chunks.
- Bumped `LATEST_SCHEMA_VERSION` to 2; added the migration to the runner; added
  5 Rust tests (durable tables exist, FK enforced, single self row, FTS indexes
  body text, plus the existing version/idempotency tests).
- **Verification (sqlite3 3.51, FTS5-capable):** applied 0001+0002 to a fresh DB
  → 33 base tables, 25 indexes, 9 triggers; FK violation rejected; second
  `is_self=1` rejected; FTS `MATCH 'planning'` returns the inserted doc; deleting
  a memory cascades its links; bad `subject_type` rejected; `PRAGMA
  integrity_check` and `foreign_key_check` both `ok`.

### 2026-06-17 — Phase 01: foundation scaffold
- Extracted Reflect Open's exact config patterns via a 5-way parallel read
  (root workspace, Tauri/Rust shell, Vite/Tailwind frontend, Kysely-IPC bridge,
  CLI sidecar) and adapted them to Local Brain naming (`@local-brain/*`, `brain`
  CLI, `brain-schema` crate, `local_brain_lib`).
- Built the monorepo: pnpm + Turborepo workspace, shared strict `tsconfig.base`,
  oxlint config, root Cargo workspace, `.gitignore`, root README.
- `packages/core`: `AppError` contract, IPC bridge abstraction, typed `call()`
  zod boundary, `app_version` binding + 3 vitest tests.
- `packages/db`: read-only Kysely `IpcDialect`, `createDb`/`json` helpers,
  placeholder `schema_meta` Database type + 3 vitest tests (camelCase→snake_case
  compile, transaction refusal, non-array guard).
- `packages/skills`: shell + skill manifest type.
- `apps/desktop`: React 19 + Vite + Tailwind v4 frontend, warm-paper design
  tokens in `globals.css`, `cn()`, Tanstack Query client, Tauri bridge install,
  Kysely runner over `db_query`, an App that exercises the typed IPC path.
- `apps/desktop/src-tauri`: Tauri 2 shell, `AppError` enum (camelCase tagged),
  `app_version` command, capabilities, `tauri.conf.json`.
- `apps/cli`: `brain` CLI (clap, `--json`, `status`/`path`, DB-path resolution,
  open/migrate via shared schema crate, typed exit codes).
- `crates/brain-schema`: migration runner, `open_and_migrate`, WAL/FK/busy-timeout
  pragmas, `0001_init.sql` (`schema_meta`), version constant + 5 tests.
- `apps/desktop/scripts/build-sidecar.mjs`: stages the `brain` sidecar.
- **Verification:** `pnpm install` ✓; `pnpm check` ✓ (4 packages: typecheck +
  oxlint + 6 tests); migration SQL applies under `sqlite3` ✓; `node --check` on
  the sidecar script ✓; tree clean (only intentional files). Cargo gates
  **deferred** (D1 — no toolchain locally).

### 2026-06-17 — Phase 00 start
- Verified environment: clean tree at `f3616d3`; node v25.8.0; pnpm 11.5.2; gh 2.87.3
  authed as `maccman`; remote `git@github.com:maccman/local-brain.git`.
- Confirmed reference repos readable: `/Users/alex/repos/reflect-open` (clean,
  `4f92fe5`) and `/Users/alex/repos/picardo-internal-ui` (clean, `5f5ef8a`).
  `/Users/alex/repos/local-brain` is a symlink to this working copy.
- Read AGENTS.md, docs/README.md, plans 00–09, architecture-conventions, libraries,
  design-system, reflect-open-technology-base.
- **Discovered blocker:** `cargo`/`rustc`/`rustup` not installed. Recorded as D1.
- Created branch `codex/local-brain-00-supervisor` from `origin/master`.
- Authored `docs/build/manifest.md`, `status.md`, `decisions.md` and laid out the
  dependency-aware PR stack (Plan 02 split into 02a/02b/02c).

- Committed (`5c02ab5`), pushed, opened **PR #1** (base `master`).

### Next
- **06** (`codex/local-brain-06-search-ai`, base `…-05b-corrections`): search/retrieval/Ask
  **plus the model-backed `Extractor`** that feeds 05a's seam through the checked BYOK model
  boundary (and golden tests over live model output). Plan 06 can also wire enrichment of
  matched people/orgs (deferred from 05a) through the same boundary.
- Thirteen PRs open and awaiting review: **#1** (supervisor), **#2** (foundation), **#3**
  (schema), **#4** (db package), **#5** (Rust IPC bridge), **#6** (core actions + seed),
  **#7** (03a desktop shell), **#8** (03b desktop shell II), **#9** (04a ingestion core),
  **#10** (04b Rust file-read primitives), **#11** (04c ingestion UI), **#12** (05a
  extraction engine), **#14** (05b corrections + relationship intelligence — `pnpm check` +
  Vite build green). Plans 02 (DB layer), 03 (desktop shell), 04 (ingestion), and **05
  (memory extraction & correction)** are complete; Plan 06 is next.
  A full end-to-end run of the assembled app (`pnpm tauri dev`/`build`) is still pending and
  is required before the app can be called done. When #1 merges to `master`, rebase the
  stack and retarget bases upward.

## Verification ledger

| Layer | Command | Result |
| --- | --- | --- |
| 00 | `git diff --check` | clean |
