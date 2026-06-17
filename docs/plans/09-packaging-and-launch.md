# Plan 09 - Packaging and Launch

**Goal:** Prepare the macOS desktop app, CLI, skills, docs, diagnostics, and acceptance
checks for a first technical-user launch.

**Depends on:** Plans 01-08.

**Unlocks:** Public/private alpha release.

## Scope

**In:** macOS app build, sidecar bundling, first-run setup, diagnostics, release docs,
launch checklist.

**Out:** Windows/Linux packaging, mobile, hosted sync, app-store distribution.

## Key Decisions

- Launch target is macOS desktop.
- The CLI ships as a sidecar or companion binary installed by the desktop app.
- First audience is agent-native technical users.
- Launch is acceptable with manual source import, not email/calendar/browser
  integrations.
- The app must be honest about local storage, cloud model calls, and privacy states.

## Implementation Steps

1. Configure Tauri macOS builds and app metadata.
2. Bundle/stage the `brain` CLI sidecar.
3. Add first-run flow:
   - choose or create local brain location,
   - create/open SQLite DB,
   - configure optional provider key,
   - optionally install agent skill.
4. Add diagnostics in UI and CLI:
   - DB open/migration status,
   - FTS/vector availability,
   - keychain/provider status,
   - CLI/skill installation status.
5. Add launch docs: install, backup, import first sources, use with Codex, privacy
   model, troubleshooting.
6. Run full smoke checklist against a clean macOS account or clean user-data directory.

## Acceptance Criteria

- A technical user can install and launch the app.
- The app creates a local SQLite brain and imports a text source.
- The user can see and correct extracted memories.
- The user can search/ask with citations.
- The user can use the `brain` CLI from a terminal.
- The user can install/use the Codex skill.
- The user can create a backup/export.
- Diagnostics report common setup failures clearly.

## Tests or Verification

- Run `pnpm check`.
- Run Cargo tests/checks for the workspace.
- Run Tauri build for macOS.
- Run CLI integration tests against a packaged or staged binary.
- Manual launch script: first run, import, extract, correct, ask, CLI search, backup.

## Open Questions

- Code signing/notarization timing is unresolved. Default: support unsigned local builds
  before investing in signed distribution.
