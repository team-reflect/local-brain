# Plan 07 - CLI and Agent Skills

**Goal:** Make the CLI and local skills the primary operating interface for adding to,
querying, and reporting from the user's local brain.

**Depends on:** Plans 01-06.

**Unlocks:** Plans 08-09.

## Scope

**In:** `brain` CLI, JSON output, local skill docs, add/search/today/report/graph
commands, provider-neutral import identity, record lookup, brain-root/database/asset
path resolution, sidecar bundling, installation checks.

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
- Agents can add projects only when the user explicitly requests a project, then link
  imports and tasks to those manually curated projects.
- Importers use provider-neutral `sources` and `external_identities`; no upstream API
  concepts land in `brain`.
- Importers should use `external_identities.kind` to distinguish upstream identifier
  scopes, for example Gmail `thread` versus `message`.
- Source-backed interaction imports can replace body text and regenerated chunks when
  the upstream source is authoritative, for example a Granola transcript replacing an
  earlier summary-only import.
- People can have multiple emails and phones. Imports dedupe through external identity,
  then contact handles, then normalized name.
- Email/calendar interactions can preserve unresolved raw participants without creating
  people.
- Transcript imports must be followed by an analysis pass that writes a summary, links
  participants/high-signal mentioned people, associates existing projects when there is
  a clear match, and creates explicit follow-up tasks and stable memories with exact
  interaction chunk evidence.
- Source-backed Granola imports return `postAnalysisRequired` in JSON output so agents
  can treat enrichment as part of the import contract.
- Assets are first-class searchable records by metadata, links, and optional local
  `asset_texts`; importers can pass attachment text without coupling `brain` to a
  provider.
- Agents can search records and produce cited reports from document or interaction
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
   - `brain source ensure --slug ... --name ...`
   - `brain add person-from-email --full-name ... --email ...`
   - `brain add document --title ... --text-file ...`
   - `brain add interaction --kind meeting --title ... --text-file ...`
   - `brain add interaction --kind meeting --source granola --external-id ... --summary ... --text-file transcript.txt --replace-body`
   - `brain add interaction --kind email --source gmail --external-kind thread --external-id ... --summary ... --participant ...`
   - `brain add project --name ... --source agent --external-kind cluster --external-id ...`
   - `brain add asset --file ... --link person:... --role avatar`
   - `brain add asset --file ... --link interaction:... --text-file ... --text-source importer`
   - `brain asset text set <asset-id> --text-file ... --source ...`
   - `brain add task --title ... --link interaction:... --link project:... --evidence interaction:...#0`
   - `brain remember --kind fact --claim ... --link person:... --evidence interaction:...#0`
6. Add read/query commands:
   - `brain search "..."`
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
   - `brain show asset ...`
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
- how to add searchable text for assets when the importer has extracted it
   - how to import email text, attachments, contacts, and raw participants through
     generic CLI commands
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
- An agent can import contacts idempotently with source/external identity metadata.
- An agent can safely skip untrusted machine email senders and receive structured reason
  codes.
- An agent can import an email body as an interaction, preserve raw participant handles,
  and link attachments as assets.
- An agent can import a Granola meeting with raw transcript body text and a separate
  summary, then refresh that body and its chunks idempotently.
- An agent can import a redacted email or meeting digest as `summary` plus searchable
  body text without storing unsafe raw quote chains.
- An agent can create a project on explicit user instruction, and imports can link
  interactions or tasks to existing projects without auto-creating topic buckets.
- An agent can add a reference note as a document.
- An agent can add an avatar, image, or attachment as a linked asset.
- An agent can search an imported attachment by filename/link metadata and by
  importer-provided text.
- An agent can inspect an asset's metadata, text status, and linked records as JSON.
- An agent can add a task linked to a person/project.
- An agent can add transcript-derived tasks linked back to their source interaction.
- An agent can generate a daily report and todo list from the terminal.
- An agent can list relationship follow-ups from the terminal.
- An agent can query the user-centered graph as JSON.
- The CLI works with the desktop app closed.
- The CLI and desktop use the same migration/schema version.
- The skill explains the schema nouns and safe write behavior.
- Settings can detect whether the CLI and skill are installed.

## Tests or Verification

- CLI snapshot tests for JSON output.
- CLI integration tests for add/search/today/show, sources, contact handles,
  external identity dedupe, guarded email senders, and raw interaction participants.
- CLI concurrent-open test with desktop-style WAL settings.
- Sidecar staging smoke test.
- Skill lint/readthrough by another agent.
- Manual Codex test using the local skill.

## Open Questions

- Exact command syntax can change during implementation, but the noun model should not.
