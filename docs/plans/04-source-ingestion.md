# Plan 04 - Source Ingestion

**Goal:** Let users and agents add first-wave sources: pasted text, markdown/plain text
files, transcript files, and folders of supported text files.

**Depends on:** Plan 02, Plan 03.

**Unlocks:** Plan 05 (extraction), Plan 06 (search), Plan 07 (agent ingestion), Plan 08
(source deletion/export).

## Scope

**In:** manual paste, file import, folder import, source records, chunk records, content
hashing, privacy defaults, import status.

**Out:** email OAuth, calendar OAuth, browser extension, PDF parsing beyond basic file
metadata, audio transcription.

## Key Decisions

- Sources are durable evidence.
- Source content is stored in SQLite for the first version.
- Imported files may also be referenced by `file_path` for auditability.
- Supported first-wave file types: `.txt`, `.md`, `.markdown`, `.srt`, `.vtt`, `.jsonl`
  transcript files when plain text can be extracted safely.
- Default privacy is `local`.
- Duplicate detection uses content hash plus source kind and path when available.

## Implementation Steps

1. Add source creation commands in `packages/core` and Rust DB write commands.
2. Add paste-text ingestion in the desktop UI.
3. Add file picker ingestion for supported text and transcript files.
4. Add folder import that recursively scans supported files and skips hidden/generated
   directories.
5. Normalize imported content into `sources` and `source_chunks`.
6. Store import metadata in `metadata_json`, including original path, size, parser, and
   warnings.
7. Create inbox items for import errors or files needing review.
8. Add basic source detail UI showing content, metadata, chunks, privacy, and derived
   memories once available.

## Acceptance Criteria

- A user can paste text and see it as a source.
- A user can import a text/markdown/transcript file and see chunks created.
- Folder import handles multiple files without blocking the UI.
- Duplicate imports do not create confusing duplicate sources without warning.
- Import errors are visible in the Inbox or source import result.

## Tests or Verification

- Unit tests for file type filtering and content hashing.
- Tests for chunk creation and source metadata.
- Folder import fixture test with supported, unsupported, hidden, and duplicate files.
- UI test for paste import and source detail rendering.

## Open Questions

- Whether raw files should be copied into a managed source archive is unresolved.
  Default for v1: reference files in place and store text content in SQLite.
