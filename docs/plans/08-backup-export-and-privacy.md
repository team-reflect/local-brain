# Plan 08 - Settings, Backup, Export, and Privacy Boundaries

**Goal:** Put storage controls, backup/export, diagnostics, model keys, and skill setup
under Settings.

**Depends on:** Plans 01-07.

**Unlocks:** Plan 09.

## Scope

**In:** SQLite backup, JSON export, deletion/archive semantics, keychain secrets,
diagnostics, external-model boundary settings, skill setup.

**Out:** hosted sync, git sync, encrypted cloud backup, row-level sensitivity labels.

## Key Decisions

- Settings owns backup and export.
- SQLite backup is the first portability story.
- JSON export is the first inspectable interchange format.
- Keychain stores provider keys and local secrets.
- Launch privacy is app-level and model-boundary based.
- Deletion should be explicit and predictable.
- Backup/export should use product states rather than storage jargon.
- Future git sync is deferred; do not design launch UI around Git.

## Implementation Steps

1. Add Settings sections:
   - storage location
   - model keys
   - backup/export
   - diagnostics
   - agent skill setup
2. Add SQLite backup:
   - choose destination
   - create consistent backup
   - verify backup can open
   - write atomically to avoid corrupt partial backups
   - include app/schema version metadata
3. Add JSON export:
   - people
   - organizations
   - affiliations
   - projects
   - tasks
   - interactions
   - documents
   - memories
   - tags
   - chat metadata
   - evidence refs and links
   - schema/export version
4. Add deletion/archive rules:
   - archive visible records by default
   - hard delete only behind confirmation
   - cascade or detach links predictably
   - rebuild derived search/chunk data after destructive operations
5. Add checkpoint rules:
   - create a SQLite backup before broad destructive operations where practical
   - create a checkpoint before high-risk AI or agent write batches
   - expose restore instructions in diagnostics
6. Add keychain integration for provider keys.
7. Add model boundary settings:
   - external model calls enabled/disabled
   - selected provider/model
   - diagnostics showing whether Ask can run
8. Add backup/export states:
   - Backed up
   - Exporting
   - Offline
   - Needs review
   - Backup failed
9. Add diagnostics:
   - database path and migration status
   - FTS/vector availability
   - keychain/provider status
   - CLI/skill installation status
   - recent failed jobs, if a jobs table exists

## Acceptance Criteria

- A user can create a restorable SQLite backup from Settings.
- A user can export JSON from Settings.
- Backup/export writes are atomic and versioned.
- Provider keys are not stored in plain settings rows.
- Destructive deletion behavior is explicit.
- High-risk write batches have a checkpoint story.
- Diagnostics explain common failures clearly.
- No launch code depends on row-level sensitivity labels.

## Tests or Verification

- Backup/restore integration test.
- JSON export snapshot test.
- Keychain mock test.
- Deletion/archive cascade tests.
- Atomic backup failure test.
- Restore-from-backup smoke test.
- Manual Settings smoke test.

## Open Questions

- Future git sync is deferred and should not block the launch backup/export story.
- Cloud-folder sync should not be recommended for the SQLite database unless/until it
  has a tested locking and conflict story.
