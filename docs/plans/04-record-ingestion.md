# Plan 04 - Record Ingestion

**Goal:** Let users and agents add documents and interactions directly, with readable
content stored in SQLite and provenance stored on the owning record.

**Depends on:** Plans 01-03.

**Unlocks:** Plans 05-08.

## Scope

**In:** manual paste, text/markdown/transcript import, folder import, asset import,
document and interaction creation, provenance metadata, safe file reads and writes,
content chunking.

**Out:** automatic email/calendar sync, browser extension capture, full OCR, cloud
storage.

## Key Decisions

- Imported artifacts become `documents`.
- Human exchanges become `interactions`.
- Email bodies and meeting/call transcripts are interactions.
- Email import should be thread-aware. Prefer one interaction per meaningful Gmail
  thread or conversation digest when the thread has long quoted history; use
  message-level interactions only for genuinely standalone messages.
- Importers store full readable source text when they import a source record. If a
  source is too sensitive, unsafe, or low-signal to store, skip the whole record and
  ledger the reason. Summaries stay in `summary` or `ai_notes`; they do not replace
  imported body text.
- Projects are first-class links, but project rows are manually created user structure.
  Imports and extraction link existing projects only; possible new projects are
  suggestions, not automatic writes.
- Transcript import is not complete at capture: run a post-analysis pass that generates
  a summary, links participants and high-signal mentioned people, links existing
  projects when there is a clear match, and extracts explicit follow-up tasks.
- Reference files, plans, notes, webpages, receipts, and specs are documents.
- Original path, URL, external ID, and content hash are optional metadata on the
  document or interaction.
- Chunking writes `content_chunks` with `record_type` and `record_id`.
- Chunking indexes only the earliest byte-identical chunk within a record. The
  complete imported body remains durable; repeated quoted email history is
  removed only from the rebuildable retrieval projection.
- File reads happen through Rust primitives with path traversal guards.
- Imported files are copied into SQLite as readable text; the original file remains
  optional provenance, not durable storage.
- Binary assets are copied into the app-managed `assets/` directory and linked through
  SQLite. Do not store image or attachment bytes as SQLite blobs.
- Future app-closed ingestion should use a typed inbox/spooler, not a local web server.

## Implementation Steps

1. Add "Add" actions from Today, Tasks, Network, Projects, and global command/search.
2. Build paste/import flow:
   - choose document or interaction
   - set title/kind/date
   - paste or load text
   - optionally link people, organizations, projects, or tasks
3. Build Rust file-read primitives:
   - user-selected files only
   - canonical path validation
   - size caps
   - content hash
   - clear unsupported-file errors
4. Build Rust asset-write primitives modeled on Reflect Open:
   - app-relative `assets/...` paths only
   - path traversal and symlink guards
   - temp-file plus rename atomic writes
   - content hash and MIME metadata
   - Tauri asset-protocol serving for local display
5. Build file import for text and markdown.
6. Add image/avatar/attachment import that writes the file, inserts or reuses the
   `assets` row, and creates the owning `asset_links` row.
7. Add transcript import that defaults to interaction kind `meeting` or `call`.
8. Add folder import for supported text-like files:
   - skip hidden/system files
   - skip unsupported binary files
   - report imported/skipped/duplicate counts
9. Compute content hashes to avoid accidental duplicates.
10. Store complete readable text on `documents.body_text` or `interactions.body_text`
    for imported source records, unless the source text is truly unavailable.
11. Generate `content_chunks` inside the same transaction.
12. Trigger extraction jobs from newly created or changed records.
13. Run transcript post-analysis for meeting/call imports:
    - summary separate from raw transcript body
    - participant and high-signal people links
    - existing project links, plus suggestions for possible new projects
    - explicit tasks linked to the source interaction with chunk evidence
    - stable transcript-backed memories with chunk evidence
14. Show imported documents, interactions, and linked assets in relevant detail pages.
15. Leave a seam for a future typed ingestion inbox:
    - app or external helper writes an envelope atomically
    - Local Brain drains it on launch or file event
    - raw record is saved before any enrichment
    - enrichment retries without blocking capture
16. Add provider-shaped import adapters that still write provider-neutral records:
    - Gmail: search/filter noise, group by thread, preserve message participants, use
      external identity kind `thread` or `message`
    - Granola: always fetch raw transcripts as interaction body text, store AI notes or
      summaries separately, support source-backed body replacement/rechunking, and
      link manually created projects when recurring meeting themes clearly match them
    - Contacts: page or stream from the native Contacts API; do not bulk export one
      giant AppleScript blob; import only names, handles, org/title, and stable ids for
      launch

## Acceptance Criteria

- A user can paste a meeting transcript as an interaction.
- A user can paste or import a reference note as a document.
- A folder import creates documents for supported files.
- Duplicate detection warns when content hash already exists.
- A user can add an avatar, logo, image, or attachment and see it on the linked record.
- Unsafe paths, oversized files, and unsupported files fail clearly without partial
  imports.
- Chunks are generated for every imported document and interaction.
- Imported records can be linked to people, organizations, projects, and tasks.
- Email and meeting imports can link to existing durable project contexts without
  requiring the user to manually file every record.
- Granola meeting imports preserve raw transcripts as durable evidence, even when a
  summary is also stored.
- Transcript imports create or update graph context: people, existing projects,
  explicit follow-up tasks, and stable memories are linked back to the source
  interaction and cited to exact chunks.

## Tests or Verification

- Unit test text normalization and chunking.
- Regression test exact chunk de-duplication, stable surviving ids, and evidence
  ref preservation during projection refresh and maintenance repair.
- Unit test path validation and unsupported-file handling.
- Integration test paste/import into SQLite.
- Integration test asset import writes bytes and metadata, then links the asset.
- Integration test duplicate detection.
- Integration test folder import counts and partial-failure behavior.
- Verify imported records appear in related detail pages and global search.

## Open Questions

- PDF parsing can be deferred if text/markdown import is enough for the first build.
- OCR, screenshot, PDF text extraction, and AI asset descriptions should be explicit
  follow-up work with model-boundary checks and no automatic backfill.
