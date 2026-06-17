# Plan 08 - Backup, Export, and Privacy

**Goal:** Make local data portable, recoverable, deletable, and understandable, with
clear privacy boundaries for agents and model providers.

**Depends on:** Plan 02, Plan 04, Plan 05, Plan 06.

**Unlocks:** Plan 09 launch readiness.

## Scope

**In:** SQLite backup, JSON export, source deletion semantics, derived-data cleanup,
privacy states, keychain rules, context-use audit.

**Out:** hosted sync, collaboration, mobile sync, Git-based multi-device sync.

## Key Decisions

- The SQLite database is durable and must be backed up.
- JSON export ships as the first portable interchange format.
- Secrets live in the OS keychain, not SQLite.
- Deleting a source must address derived chunks, embeddings, memories, and citations.
- Privacy states from the launch schema drive retrieval and cloud-model eligibility.
- No hosted Local Brain sync is required for MVP.

## Implementation Steps

1. Add backup commands for safe SQLite file copy using SQLite backup APIs or an
   equivalent consistent snapshot mechanism.
2. Add JSON export for durable tables and selected metadata.
3. Add source deletion flow:
   - delete source only,
   - delete source plus derived memories,
   - archive instead of hard delete when safer.
4. Add derived cleanup for chunks, FTS rows, and embeddings.
5. Add settings UI for privacy defaults and model provider behavior.
6. Add answer/context audit metadata showing sources, memories, provider, model, and
   external-context status.
7. Add recovery documentation for restoring a backup/export.

## Acceptance Criteria

- A user can create a SQLite backup without corrupting an open DB.
- A user can export durable memory to JSON.
- A user can delete or archive a source with clear derived-data choices.
- Provider keys are stored in the OS keychain only.
- Cloud AI calls exclude `never_external` context.
- The UI can explain whether context left the machine for a given answer.

## Tests or Verification

- Backup/restore smoke test.
- JSON export schema test.
- Deletion tests covering source-only, source-plus-derived, and archive paths.
- Privacy filter tests against retrieval and AI calls.
- Keychain mock tests for provider credentials.

## Open Questions

- The first backup destination UX is unresolved. Default: user-chosen local file export.
