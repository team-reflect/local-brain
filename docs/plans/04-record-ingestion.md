# Plan 04 - Record Ingestion

**Goal:** Let users and agents add documents and interactions directly, with readable
content stored in SQLite and provenance stored on the owning record.

**Depends on:** Plans 01-03.

**Unlocks:** Plans 05-08.

## Scope

**In:** manual paste, text/markdown/transcript import, folder import, document and
interaction creation, provenance metadata, safe file reads, content chunking.

**Out:** automatic email/calendar sync, browser extension capture, full OCR, cloud
storage.

## Key Decisions

- Imported artifacts become `documents`.
- Human exchanges become `interactions`.
- Email bodies and meeting/call transcripts are interactions.
- Reference files, plans, notes, webpages, receipts, and specs are documents.
- Original path, URL, external ID, and content hash are optional metadata on the
  document or interaction.
- Chunking writes `content_chunks` with `record_type` and `record_id`.
- File reads happen through Rust primitives with path traversal guards.
- Imported files are copied into SQLite as readable text; the original file remains
  optional provenance, not durable storage.
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
4. Build file import for text and markdown.
5. Add transcript import that defaults to interaction kind `meeting` or `call`.
6. Add folder import for supported text-like files:
   - skip hidden/system files
   - skip unsupported binary files
   - report imported/skipped/duplicate counts
7. Compute content hashes to avoid accidental duplicates.
8. Store readable text on `documents.body_text` or `interactions.body_text`.
9. Generate `content_chunks` inside the same transaction.
10. Trigger extraction jobs from newly created or changed records.
11. Show imported documents and interactions in relevant detail pages.
12. Leave a seam for a future typed ingestion inbox:
    - app or external helper writes an envelope atomically
    - Local Brain drains it on launch or file event
    - raw record is saved before any enrichment
    - enrichment retries without blocking capture

## Acceptance Criteria

- A user can paste a meeting transcript as an interaction.
- A user can paste or import a reference note as a document.
- A folder import creates documents for supported files.
- Duplicate detection warns when content hash already exists.
- Unsafe paths, oversized files, and unsupported files fail clearly without partial
  imports.
- Chunks are generated for every imported document and interaction.
- Imported records can be linked to people, organizations, projects, and tasks.

## Tests or Verification

- Unit test text normalization and chunking.
- Unit test path validation and unsupported-file handling.
- Integration test paste/import into SQLite.
- Integration test duplicate detection.
- Integration test folder import counts and partial-failure behavior.
- Verify imported records appear in related detail pages and global search.

## Open Questions

- PDF parsing can be deferred if text/markdown import is enough for the first build.
- OCR, screenshot, PDF text extraction, and AI asset descriptions should be explicit
  follow-up work with model-boundary checks and no automatic backfill.
