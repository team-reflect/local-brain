# Plan 07 - CLI and Agent Skills

**Goal:** Ship the `brain` CLI and local agent skills so Codex and other local agents
can ingest, query, and write memories safely.

**Depends on:** Plan 01, Plan 02, Plan 04, Plan 05, Plan 06.

**Unlocks:** Plan 09 launch loop for agent-native users.

## Scope

**In:** CLI binary, JSON output contracts, search/remember/ingest/today/entity commands,
skill templates, install diagnostics, agent audit trail.

**Out:** local HTTP API, plugin marketplace, multi-user permissions.

## Key Decisions

- The CLI is the first stable agent contract.
- Agents should not use raw SQL as the default interface.
- CLI output must be machine-readable with `--json`.
- Agent writes are audited in `agent_events`.
- Default agent writes create active memories with provenance and confidence.

## Implementation Steps

1. Add the `brain` CLI crate with DB discovery/opening, command parsing, JSON output,
   and human-readable output.
2. Implement commands:
   - `brain status`
   - `brain ingest <path>`
   - `brain remember <text>`
   - `brain search <query> --json`
   - `brain ask <query> --json`
   - `brain today --json`
   - `brain entity <name> --json`
   - `brain doctor`
3. Ensure CLI writes use the same core validation and DB transaction rules as the app.
4. Add skill templates in `packages/skills` for Codex first.
5. Add app UI to show installed/configured agent skills.
6. Add diagnostics for missing CLI, missing DB, locked DB, and missing provider keys.

## Acceptance Criteria

- A local agent can search memory with `brain search`.
- A local agent can add an active memory with `brain remember`.
- CLI commands return stable JSON suitable for skills.
- `brain doctor` reports actionable local setup issues.
- Agent-originated changes are visible in the app and audited.
- The first Codex skill explains search, remember, ingest, citations, and privacy rules.

## Tests or Verification

- CLI integration tests against a fixture SQLite DB.
- JSON schema tests for command outputs.
- Tests for agent event records on writes.
- Skill text review for privacy and provenance instructions.
- Manual test: run a Codex-like workflow using only the CLI.

## Open Questions

- Whether to expose a localhost API later is unresolved. Default: CLI only for MVP.
