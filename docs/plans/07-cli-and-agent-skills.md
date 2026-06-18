# Plan 07 - CLI and Agent Skills

**Goal:** Make the CLI and local skills the primary operating interface for adding to,
querying, and reporting from the user's local brain.

**Depends on:** Plans 01-06.

**Unlocks:** Plans 08-09.

## Scope

**In:** `brain` CLI, JSON output, local skill docs, add/search/ask/today/report/graph
commands, record lookup, brain-root/database/asset path resolution, sidecar bundling, installation
checks.

**Out:** hosted API, plugin marketplace, automatic external app sync.

## Key Decisions

- The CLI is the agent contract.
- The CLI is expected to handle most writes and reads.
- The CLI is a self-contained Rust binary, not a Node wrapper.
- CLI writes use the same SQLite schema/migration crate as the desktop app.
- The CLI opens the SQLite database directly; it does not require the desktop app to be
  running and does not use Tauri IPC.
- Agents can add people, documents, interactions, assets, tasks, and memories with direct
  provenance.
- Agents can search and ask, but cited answers still come from document or interaction
  chunks.
- stdout carries data only; diagnostics and warnings go to stderr.
- `--json` output shapes are stable and snapshot-tested.
- There is no top-level automation log table or UI surface for launch.

## Reflect Open Patterns To Reuse

- Cargo workspace with `apps/cli` and a shared schema crate.
- Same bundled rusqlite/SQLite version for desktop and CLI.
- Read/write DB opens use WAL, busy timeout, and clear errors.
- Sidecar bundling through Tauri `bundle.externalBin` in desktop platform configs.
- Sidecar build script runs before Tauri dev/build and uses the target triple.
- CLI JSON contracts are documented and snapshot-tested.

## Implementation Steps

1. Add `apps/cli` Rust binary:
   - package `brain-cli`
   - binary name `brain`
   - `clap` command surface
   - shared error-to-exit-code mapping
2. Add brain-root resolution:
   - explicit `--brain <directory>`
   - `BRAIN_ROOT` environment variable
   - newest recent brain root from the OS-config recents store
   - advanced `--db <path>` / `BRAIN_DB` override for tests and diagnostics
   - clear error if no brain root or database exists
3. Add SQLite open behavior:
   - use `crates/brain-schema`
   - check schema version
   - open with WAL/busy timeout
   - write commands run in transactions
   - read commands tolerate a busy desktop writer where possible
4. Add configuration commands:
   - `brain status`
   - `brain doctor`
   - `brain path`
5. Add write commands:
   - `brain add person --full-name ... --email ...`
   - `brain add document --title ... --text-file ...`
   - `brain add interaction --kind meeting --title ... --text-file ...`
   - `brain add asset --file ... --link person:... --role avatar`
   - `brain add task --title ...`
   - `brain remember --kind fact --claim ... --link person:...`
6. Add read/query commands:
   - `brain search "..."`
   - `brain ask "..."`
   - `brain today`
   - `brain report daily`
   - `brain tasks plan-day`
   - `brain relationships followups`
   - `brain changes --since ...`
   - `brain graph --center self`
   - `brain show person ...`
   - `brain show organization ...`
   - `brain show project ...`
   - `brain show task ...`
7. Define output contracts:
   - stdout data only
   - stderr diagnostics only
   - documented exit codes
   - stable `--json` camelCase shapes
8. Add sidecar bundling:
   - build script for target-suffixed binary
   - Tauri desktop platform config with `bundle.externalBin`
   - generated binaries ignored by git
   - dev and build commands both stage the sidecar
9. Add Codex/local-agent skill:
   - when to add a document versus interaction
   - how to cite evidence
   - how to avoid duplicate records
   - how to add and link binary assets without inlining bytes into SQLite text fields
   - how to query before writing
   - how to run a daily automation
   - how to produce a report and todo list
   - how to query graph context
   - what not to store
10. Add install/setup flow in Settings:
   - detect sidecar
   - optional symlink/install command into PATH on macOS
   - show exact command path if not installed globally
11. Add CLI integration tests against a temporary SQLite database.

## Acceptance Criteria

- An agent can add a meeting transcript as an interaction.
- An agent can add an explicit contact as a person without coupling the CLI to a source
  provider.
- An agent can add a reference note as a document.
- An agent can add an avatar, image, or attachment as a linked asset.
- An agent can add a task linked to a person/project.
- An agent can ask a cited question from the terminal.
- An agent can generate a daily report and todo list from the terminal.
- An agent can list relationship follow-ups from the terminal.
- An agent can query the user-centered graph as JSON.
- The CLI works with the desktop app closed.
- The CLI and desktop use the same migration/schema version.
- The skill explains the schema nouns and safe write behavior.
- Settings can detect whether the CLI and skill are installed.

## Tests or Verification

- CLI snapshot tests for JSON output.
- CLI integration tests for add/search/ask/today/show.
- CLI concurrent-open test with desktop-style WAL settings.
- Sidecar staging smoke test.
- Skill lint/readthrough by another agent.
- Manual Codex test using the local skill.

## Open Questions

- Exact command syntax can change during implementation, but the noun model should not.
