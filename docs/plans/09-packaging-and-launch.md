# Plan 09 - Packaging and Launch

**Goal:** Prepare the macOS desktop app, CLI, skills, docs, diagnostics, and acceptance
checks for a first technical-user launch.

**Depends on:** Plans 01-08.

**Unlocks:** Public/private alpha release.

## Scope

**In:** macOS app build, sidecar bundling, first-run setup, diagnostics, release docs,
launch checklist, signing/notarization readiness, performance and privacy review,
update-path decision.

**Out:** Windows/Linux packaging, mobile, hosted sync, app-store distribution.

## Key Decisions

- Launch target is macOS desktop.
- The CLI ships as a sidecar or companion binary installed by the desktop app.
- First audience is agent-native technical users.
- Launch is acceptable with manual document and interaction import.
- Launch must prove the Codex automation loop, not just the desktop UI.
- The app must be honest about local storage and external model boundaries.
- Performance, accessibility, and packaging checks are release gates, not polish.
- Native sidecars and dylibs need signing/notarization attention early.

## Implementation Steps

1. Configure Tauri macOS builds and app metadata.
2. Bundle/stage the `brain` CLI sidecar:
   - `bundle.externalBin` in desktop platform config
   - target-suffixed binary in `src-tauri/binaries`
   - build-sidecar script before Tauri dev/build
   - verify the CLI runs from inside the packaged app
3. Add first-run flow:
   - choose or create local brain location
   - create/open SQLite DB
   - configure optional AI provider key
   - optionally install agent skill
4. Add keyboard and accessibility pass:
   - sidebar
   - command palette
   - Ask
   - Graph
   - Settings
   - visible focus rings
   - reduced motion where relevant
5. Add performance budgets:
   - cold open
   - DB open/migration
   - command palette query latency
   - Today daily brief retrieval
   - graph render against seed-large data
   - memory footprint
6. Add diagnostics in UI and CLI:
   - DB open/migration status
   - FTS/vector availability
   - keychain/provider status
   - CLI/skill installation status
   - sidecar path/status
7. Add privacy/model-boundary review:
   - keys are keychain-only
   - no hosted Local Brain service in the core path
   - external model payloads are visible and minimal
   - cited answers link to evidence
8. Add signing/notarization checklist:
   - Apple Developer ID signing
   - hardened runtime
   - `sqlite-vec` and embedding runtime dylibs signed
   - `brain` sidecar signed inside the app bundle
   - unsigned local builds remain supported before public release
9. Decide update path:
   - defer auto-update for alpha, or
   - use official Tauri updater plugin with GitHub Releases-hosted artifacts
   - keep updater signing key separate from Apple signing key
10. Add launch docs:
   - install
   - local storage
   - importing first document or interaction
   - using with Codex
   - model boundaries
   - troubleshooting
11. Run full smoke checklist against a clean macOS account or clean user-data directory.

## Acceptance Criteria

- A technical user can install and launch the app.
- The app creates a local SQLite brain and imports a document or interaction.
- The user can browse Today, Tasks, Network Graph/People/Organizations, and Projects.
- The user can search/ask with citations.
- The user can use the `brain` CLI from a terminal.
- The user can install/use the Codex skill.
- A Codex daily automation can update records and produce a daily report/todo list.
- Diagnostics report common setup failures clearly.
- Packaged app includes a runnable `brain` sidecar.
- Release checklist covers accessibility, performance, model-boundary review, and native
  signing/notarization risks.

## Tests or Verification

- Run `pnpm check`.
- Run Cargo tests/checks for the workspace.
- Run Tauri build for macOS.
- Run CLI integration tests against a packaged or staged binary.
- Run accessibility smoke pass.
- Run performance smoke pass against seed-large data.
- Manual launch script: first run, install skill, import document, import interaction,
  extract, graph, ask, CLI search, daily report, todo list.

## Open Questions

- Code signing/notarization timing is unresolved. Default: support unsigned local builds
  before investing in signed distribution.
