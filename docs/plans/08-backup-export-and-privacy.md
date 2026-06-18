# Plan 08 - Settings and Privacy Boundaries

**Goal:** Put diagnostics, AI providers, local database visibility, skill setup, and
privacy boundaries under Settings.

**Depends on:** Plans 01-07.

**Unlocks:** Plan 09.

## Scope

**In:** deletion/archive semantics, keychain secrets, diagnostics, external-model
boundary settings, skill setup, and local database path visibility.

**Out:** hosted sync, git sync, encrypted cloud backup, app-managed backup/export,
and row-level sensitivity labels.

## Key Decisions

- Settings owns AI providers, local database path, diagnostics, and skill setup.
- App-managed backup/export is deferred; SQLite remains the durable source of truth.
- Keychain stores AI provider keys and local secrets.
- Launch privacy is app-level and model-boundary based.
- Deletion should be explicit and predictable.
- Future git sync is deferred; do not design launch UI around Git.

## Implementation Steps

1. Add Settings sections:
   - general
   - AI providers
   - local database
   - diagnostics
   - agent skill setup
2. Add deletion/archive rules:
   - archive visible records by default
   - hard delete only behind confirmation
   - cascade or detach links predictably
   - rebuild derived search/chunk data after destructive operations
3. Add keychain integration for AI provider keys.
4. Add model boundary settings:
   - external model calls enabled/disabled
   - selected provider/model
   - diagnostics showing whether Ask can run
5. Add diagnostics:
   - database path and migration status
   - FTS/vector availability
   - keychain/provider status
   - CLI/skill installation status
   - recent failed jobs, if a jobs table exists

## Acceptance Criteria

- Provider keys are not stored in plain settings rows.
- Destructive deletion behavior is explicit.
- Diagnostics explain common failures clearly.
- Settings exposes the local SQLite path without providing backup/export actions.
- No launch code depends on row-level sensitivity labels.

## Tests or Verification

- Keychain mock test.
- Deletion/archive cascade tests.
- Settings smoke test.
- Diagnostics smoke test.

## Open Questions

- Backup/export remains future work and should not block launch.
- Cloud-folder sync should not be recommended for the SQLite database unless/until it
  has a tested locking and conflict story.
