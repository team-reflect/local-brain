# Local Brain — Current Product State

A snapshot of what Local Brain **is and does today**, grounded in the implemented
code (PR stack complete through Plan 09). It is written for Alex and for agents who
need to understand the product, its surfaces, data model, and caveats without
reading the whole implementation stack.

> Scope note: this describes the implementation merged on the
> `codex/local-brain-09-packaging-launch` stack (PRs #15 search/retrieval/AI, #16
> CLI/agent skills, #17 settings/backup/privacy, #19 packaging/launch, on top of
> #1–#14). PR #18 (Reflect design-system migration) is **separate, independent
> pending design work** and is not part of this stack. Where a statement is
> inferred from surrounding code rather than read line-by-line, it is marked
> *(inferred)*. For aspirational direction see [`product-thesis.md`](product-thesis.md)
> and the numbered [`plans/`](plans/00-overview.md); this doc is the as-built view.

## Purpose & mental model

Local Brain is a **private, local-first personal CRM and knowledge base** that local
AI agents operate on the user's behalf. SQLite is the durable source of truth;
nothing is uploaded by the product itself. Markdown is *not* the storage format
(this is the deliberate divergence from Reflect Open, whose technology base Local
Brain reuses).

The mental model has two operators over one database:

- **Agents are the primary read/write path.** A Codex (or similar) automation
  ingests context, updates records, records memories, and produces daily reports/
  todo lists through the `brain` CLI and the `brain` agent skill — without the user
  opening the app.
- **The desktop UI is the inspection/correction surface.** It exists for quick
  browsing, fixing mistakes where the user naturally sees them, and demonstrating
  what the brain knows. It is not optimized for bulk data entry.

The schema *is* the product: the system models what a person, organization,
project, task, interaction, document, and memory are, rather than offering a
generic table editor.

## Architecture at a glance

```text
apps/desktop/        Tauri 2 + React 19 desktop app (browse/correct/inspect)
  src/               frontend: surfaces, routing, command palette, IPC call()
  src-tauri/         Rust shell: DB bridge, file reads, keychain, backup, storage
apps/cli/            the `brain` CLI (standalone Rust; opens SQLite directly)
packages/core/       TS product logic: ingest, extraction, retrieval, ai, reports, domains
packages/db/         Kysely schema/types + read-only IPC dialect
packages/skills/     registers the local `brain` agent skill
crates/brain-schema/ durable SQLite migrations + open/migrate helpers
skills/brain/        SKILL.md — the agent-readable contract
```

Boundaries that hold across the codebase:

- **Rust owns SQLite** connections, migrations, transactions, and native
  primitives. The desktop frontend reaches SQLite only through a
  Kysely-compiles-SQL / Rust-executes-SQL bridge over Tauri IPC.
- Every `#[tauri::command]` returns `Result<T, AppError>`; the frontend validates
  responses with zod at the single `call()` boundary in `@local-brain/core` and
  never imports `@tauri-apps/api` directly.
- The desktop DB bridge is read-or-write-aware: `db_query` rejects any
  non-read-only statement, `db_execute` is a single write, and `db_batch` runs
  every statement in one transaction (rolls back on failure). Multi-table writes go
  through `db_batch`, not the read path.
- **The CLI does not use the desktop or IPC at all.** It opens the same SQLite file
  directly via `brain-schema`, so it works whether or not the app is running.

## Data model (durable SQLite schema)

The schema lives in `crates/brain-schema/migrations/` (`0001_init.sql`,
`0002_launch_schema.sql`) and is mirrored to TypeScript types in
`packages/db/src/schema.gen.ts` (regenerated and drift-checked in CI). It is a
typed personal-CRM schema — **not** a generic graph-node table. Conventions: ULID
TEXT primary keys, ISO-8601 UTC `TEXT` timestamps, `YYYY-MM-DD` dates, `0/1`
booleans, and polymorphic `record_type`/`subject_type` columns carrying a `CHECK`
of allowed values (they cannot use SQL foreign keys).

Durable entity tables:

- **people** — the user is the single row with `is_self = 1` (enforced by a partial
  unique index). Carries relationship-intelligence fields: `relationship_strength`,
  `reconnect_interval_days`, `last_interaction_at`, `next_reconnect_at`,
  `important_dates_json`, plus `current_organization_id`.
- **organizations** — companies, schools, teams, vendors, clubs, etc.
- **affiliations** — time-bound person↔organization links (title, role,
  `started_on`/`ended_on`, `is_current`).
- **projects** — areas of work with `status`, `kind`, target/started/completed
  dates.
- **tasks** — `status`, `priority`, `due_at`, `scheduled_for`, optional
  `project_id`, and `origin_document_id` / `origin_interaction_id` provenance.
- **interactions** — meetings, calls, emails, messages, notes, events; `kind`,
  `occurred_at`/`ended_at`, `body_text`, provenance (`original_path`,
  `original_url`, `content_hash`).
- **documents** — readable reference material; `body_text` stored directly, plus
  `mime_type`, `original_path`, `original_url`, `content_hash`, `authored_at`.
- **memories** — hidden atomic claims (`kind`, `claim`, `confidence`,
  `valid_from`/`valid_to`).
- **tags** + **taggings**, **chat_conversations** + **chat_messages** (the Ask
  history), and **settings** (typed key/value JSON store).

Linking, provenance, and derived tables:

- **memory_links** — a memory → one visible record (person/org/project/task/
  document/interaction).
- **evidence_refs** — a `memory | task | chat_message` → an exact `content_chunk`,
  with optional `quote_start`/`quote_end` span and note. This is how citations are
  stored.
- **15 typed join tables** (e.g. `interaction_participants`, `project_people`,
  `document_organizations`, `task_interactions`, …) — each with two cascading FKs, a
  `role`, and a uniqueness guard on the pair. The Graph and detail-page neighborhoods
  are assembled from these.
- **content_chunks** — paragraph-aware chunks derived from document/interaction
  text, with `content_hash` and `token_count`.
- **FTS5 virtual tables** — `documents_fts`, `interactions_fts`,
  `content_chunks_fts` (external-content, `porter unicode61`, kept in sync by
  triggers).

Only `content_chunks` and the FTS tables are derived/rebuildable; everything else
is durable user data. Migrations run automatically at startup and the schema is
versioned.

## Desktop surfaces

Top-level navigation (routes in `apps/desktop/src/routing/route.ts`), each with a
keyboard shortcut (`Mod` = ⌘ on macOS):

| Surface | Shortcut | What it shows today |
| --- | --- | --- |
| **Today** | ⌘1 | AI daily brief: bucketed tasks (due/scheduled/waiting), recent interactions, and a **Reconnect** section from relationship intelligence. |
| **Tasks** | ⌘2 | Task list with status filter and inline complete/archive; linked evidence on detail. |
| **Network** | ⌘3 | People and Organizations tabs (`network?tab=people|organizations`) with detail pages. |
| **Projects** | ⌘4 | Project list + detail (tasks, people, orgs, interactions, documents). |
| **Graph** | ⌘5 | User-centered SVG node map: self-hub plus join-table edges, radial layout, click-to-navigate, legend, per-kind node caps with a truncation note. |
| **Ask** | ⌘6 | Cited AI chat over the brain (see below). |
| **Settings** | ⌘, | General / Model keys / Local database / Backup & export / Skills / Diagnostics (`settings?section=…`). |

Detail pages exist for **person, organization, project, task, document,
interaction**. Documents and interactions are first-class records but are *not*
top-level nav — they are reached through detail pages, search, and Ask. Detail
pages render a typed-link neighborhood (`LinkedRecords`), a `MemoryList`, and a
`CitationList`, each with in-place correction affordances (Unlink / Archive /
Remove). Person detail additionally shows the derived "Reconnect by" field.

Cross-surface affordances:

- **Command palette** (⌘K) — live record search via the FTS-backed `globalSearch`,
  with arrow-key navigation. Hand-rolled (not `cmdk`).
- **Add** — an `AddRecordDialog` (also ⌘⇧D / ⌘⇧I, or the command-bar **Add**
  button) with a Document/Interaction toggle and a Paste / Import-folder mode
  toggle.
- **Navigation shortcuts** — ⌘1–⌘6 to surfaces, ⌘[ / ⌘] back/forward, ⌘⇧T new
  task, ⌘⇧R run daily report. Keybindings are unique (a duplicate-binding test
  enforces it).
- **First-run** — a one-time welcome overlay (gated by a `firstRun.completed`
  settings flag) stating where the data lives, the honest model-boundary status,
  and how to start.

## Ingestion & memory extraction

**Ingestion** (`packages/core/src/ingest`) is deterministic and local. Pasted text
or an imported file/folder is normalized → paragraph-chunked → SHA-256 content-
hashed → dedupe-checked → written as a document or interaction with its
`content_chunks` and optional people/org/project/task links, all in **one**
`db_batch` transaction. Identical content dedupes automatically (surfaced as
`isDuplicate`); `--allow-duplicate` / the dialog override forces a re-import. The
content hash is computed over *normalized* text so a pasted note and the same file
imported later dedupe identically.

In the UI, file/folder selection is via a typed **path field**, not a native
picker (a deliberate choice to keep the build hermetic and testable; a native
Tauri dialog is a follow-up). Rust file-read primitives
(`src-tauri/src/fs.rs`) enforce a 5 MiB cap, require valid UTF-8, detect kind by
extension, and skip hidden/unsupported/oversized/binary/duplicate files and
anything that resolves outside the chosen root via a symlink.

**Extraction** (`packages/core/src/extraction` + `ai/extractor.ts`) turns ingested
records into people, organizations, affiliations, projects, tasks, and hidden
memories. Two halves:

- The **deterministic engine** owns the extraction *contract* (a zod-validated
  output shape a model must produce), pre-processing (date/email finding, chunk
  selection, context assembly), conservative **matching** (exact key, then
  normalized name — no fuzzy/embedding match yet), and `applyExtraction`, which
  resolves every reference to an existing-or-new row, writes new records, links
  them to the source, creates memories with `memory_links`, and attaches
  `evidence_refs` — all in one `db_batch`.
- **Confidence gating:** entities below `minConfidence` become **suggestions**
  rather than writes; obvious duplicates are skipped; unresolved evidence/links are
  reported, never guessed. The product applies high-confidence changes directly and
  lets users correct from visible detail pages rather than forcing a review queue.

**Important boundary — no faked extraction.** Extraction runs through a typed
`Extractor` seam. The model-backed extractor (`createModelExtractor()`, Plan 06) is
the only thing that produces entities from prose, and it only runs when a provider
key is configured. **With no model configured, extraction is a safe no-op** — there
are no hidden heuristics inventing people or memories. Capture (ingest, chunk,
dedupe, manual links) still works fully without a model.

Relationship intelligence (`relationships/`) is pure deterministic date math: a
transparent 1–5 strength formula plus derived `last_interaction_at`,
`next_reconnect_at`, and `relationship_strength`, recomputed incrementally after
relevant interactions and in bulk on first-run seed. `important_dates_json` is
**not** currently derived (no schema field supplies the dates).

## Search, retrieval & Ask (with citations)

Retrieval (`packages/core/src/retrieval`) is one shared `retrieve()` contract over
the FTS5 `content_chunks`: bm25 ranking + `snippet()`, OR-recall query
sanitization, and a recency + link-boost re-rank. It exposes `mode:
lexical | semantic | hybrid`, but **semantic/embeddings are not implemented** — with
`semanticAvailable: false` it degrades cleanly to lexical. `globalSearch()` spans
the six record types (FTS for documents/interactions, name LIKE for
people/orgs/projects/tasks) and backs the command palette.

**Ask** (`ai/ask.ts`) is a grounded, cited pipeline:

1. Retrieve the relevant chunks.
2. Assemble a minimal model context through one checked helper
   (`assembleAnswerContext` + `citedSubset`).
3. If a model is available, synthesize an answer; **persist `evidence_refs` per
   cited source on the assistant chat message** so each citation opens the exact
   owning document/interaction.
4. If no model is available, Ask shows an honest "not configured" closed-boundary
   banner and still surfaces the cited evidence.

### Model boundary (BYOK)

Local Brain **bundles no model**. The AI surface is bring-your-own-key:

- A runtime `ModelProvider` seam (`ai/provider.ts`) with a concrete
  `createAnthropicProvider` (Anthropic). `getModelStatus()` is true only when a
  provider is **available and enabled**.
- **Desktop** stores the key in the **macOS keychain** (via the `security` CLI in
  `src-tauri/src/keychain.rs`) — never a settings row, never the export. A dev
  environment-variable override exists.
- **CLI** reads `ANTHROPIC_API_KEY` from the environment and shells out to `curl`
  (dependency-free); with no key, `brain ask` returns `answered:false` plus the
  cited evidence for the calling agent to reason over.
- A master **kill switch** (Settings → Model keys) disables all external calls
  regardless of key.
- External payloads are minimal and gated: only the retrieved, cited chunks needed
  to answer are sent; a CSP restricts `connect-src` to known provider hosts.

With no key the product degrades cleanly: Ask says "not configured", extraction is
a no-op, and lexical FTS search always works.

## CLI & agent skill

The `brain` CLI (`apps/cli`, standalone Rust) is the primary agent contract. It
ports the app's ULID/normalize/chunk/SHA-256 logic so CLI-written and app-written
records dedupe and chunk identically, and resolves the database via `--db` →
`$BRAIN_DB` → platform default. Output contract: **stdout is data, stderr is
diagnostics**; `--json` gives stable camelCase; exit codes `0` ok / `1` runtime /
`3` not found / `4` no database.

Commands:

- **Write:** `add document|interaction|task`, `remember` (a memory with
  provenance). `--text` / `--text-file <path>` (or `-` for stdin),
  `--link <type>:<id>`, `--allow-duplicate`.
- **Read:** `search`, `ask` (always returns cited evidence; synthesizes + persists
  a conversation when a model is configured), `show <type> <id>`, `today`,
  `report daily`, `tasks plan-day`, `relationships followups`, `changes --since`,
  `graph --center self`.
- **Ops:** `status`, `path`, `doctor` (schema version, model configured, curl
  available).

CLI retrieval is lexical (the same FTS SQL as the app, without the recency re-rank,
for stable snapshots).

The agent **skill** is `skills/brain/SKILL.md` (registered via
`packages/skills`): it teaches the nouns (document ≠ interaction ≠ task ≠ memory),
query-before-write, the stdout/stderr contract, write/read recipes, a daily-
automation recipe, and what *not* to store (secrets, raw logs, speculation).
Desktop **Settings → Skills** shows the CLI usage and skill path.

**Sidecar packaging:** `tauri.conf.json` declares `bundle.externalBin:
["binaries/brain"]` and `pnpm sidecar` stages `brain-<triple>`; `pnpm tauri build`
embeds the CLI in the app at `Contents/MacOS/brain`. Sidecar *detection* in
Settings and PATH installation are noted as follow-ups.

## Storage, backup, export & privacy

- **One SQLite file**, path resolved `--db` (CLI) → `$BRAIN_DB` → platform default
  `~/Library/Application Support/local-brain/brain.sqlite` (macOS). App and CLI
  resolve the same path. Shown in Settings → Local database / Diagnostics.
- **Backup** (`DbState::backup_to`): a consistent `VACUUM INTO` snapshot →
  integrity check → atomic rename, so a crash never leaves a corrupt partial. This
  is the **restore path**: replace the file and reopen; derived indexes rebuild.
- **Export** (`domains/backup/assembleExport`): a versioned, inspectable JSON dump
  over the durable tables. It is interchange, **not** a re-import path yet, and is
  **not** the restore path.
- **Neither backup nor export contains provider keys.**
- **Maintenance** (`domains/maintenance`): `hardDeleteRecord` (cascade + derived-
  chunk cleanup) and `rebuildSearchIndexes` (FTS5 rebuild).
- **Privacy posture:** no hosted Local Brain service in the core path; SQLite is the
  only store. External model calls require a present key **and** the enable
  switch, both surfaced in Settings → Model and Diagnostics. There are **no
  row-level sensitivity labels** (an explicit launch non-goal).

## Packaging & launch status

- `pnpm tauri build` compiles the app and produces
  `target/release/bundle/macos/Local Brain.app` (identity `app.localbrain.desktop`
  v0.1.0) with the **`brain` sidecar embedded and runnable** at
  `Contents/MacOS/brain`. This `.app` is the runnable artifact.
- **Known caveat (Plan 09):** the `.dmg` step **fails in a headless build** —
  `bundle_dmg.sh` drives Finder via AppleScript and needs a GUI/login session.
  Produce the DMG on a developer workstation.
- **Unsigned alpha.** Code signing / notarization are deferred (checklist in
  [`launch/checklist.md`](launch/checklist.md)); Gatekeeper will warn (right-click →
  Open, or strip the quarantine xattr).
- **Accessibility:** a visible `:focus-visible` keyboard ring and a
  `prefers-reduced-motion` block are in place; a manual VoiceOver pass is
  recommended before public alpha.
- **Update path:** auto-update is deferred for alpha (replace the `.app`); the
  Tauri updater plugin is the post-alpha plan.
- The full GUI app was **not launched headless** on the build host (no window
  server); the compile + bundle + embedded-sidecar run is the smoke test. An
  end-to-end interactive launch remains pending.

See [`launch/README.md`](launch/README.md) for the install/usage guide and
[`launch/checklist.md`](launch/checklist.md) for release gates.

## Known limitations & caveats

- **No model bundled / no offline AI.** Ask and extraction need a BYOK provider
  key. Without one: capture and lexical search work; Ask and extraction do not.
- **Lexical search only.** Embeddings/semantic/hybrid retrieval is a clean-degrading
  seam, not implemented.
- **Conservative extraction matching** — exact-key / normalized-name only; no
  fuzzy or embedding-based entity resolution. Matched existing tasks gain a source
  link + evidence but their fields are not mutated by extraction.
- **No native file picker** in ingestion (typed path field); **no PDF/OCR**; **no
  automatic email/calendar sync** (explicit launch non-goals).
- **`important_dates_json` is not derived** — no schema field currently supplies
  important dates.
- **Export is not re-importable**, and **restore is file-replacement**, not a
  guided in-app flow.
- **macOS-only** keychain/backup paths; non-macOS returns a clear error / no-op.
- **Headless DMG/Finder caveat** above; signing/notarization pending.
- A full interactive `tauri dev`/launch verification is still pending.

## Open / next product questions

Carried from [`open-questions.md`](open-questions.md), the live ones most relevant
to the current build:

- Which extraction model is good enough to apply directly without mandatory review,
  and how should the app explain external model calls without feeling scary?
- Is BYOK enough for the first alpha, or should Ask run on a bundled local model? If
  semantic search lands, which embedding backend packages most easily on macOS?
- How dense should Graph be — demo surface, practical navigation, or both?
- Which relationship-intelligence signals belong on Today (stale relationships,
  important dates, recent changes, reconnect cadence)?
- Do we sign/notarize the first macOS build, and should the CLI auto-install into
  PATH or show a copyable command?
- Which backup format should users trust first — the SQLite copy, the JSON export,
  or both — and should export become a re-import path?
</content>
</invoke>
