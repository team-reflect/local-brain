# Architecture Conventions

These conventions apply across the implementation plans.

## Source of Truth

SQLite is durable product storage. Derived indexes, FTS tables, vector tables, and
denormalized views may be rebuilt, but durable memory tables must not be casually wiped.

## Data Boundaries

- Rust owns SQLite connections, migrations, transactions, native extensions, file
  access, keychain access, and sidecars.
- TypeScript owns product policy, UI state, typed query construction, ingestion logic,
  retrieval orchestration, and AI policy.
- Tauri IPC is an external boundary and should validate command payloads.
- Kysely types should be generated from migrations and used for database signatures.

## Durable vs Derived Data

Durable:

- sources
- memories
- entities
- relationships
- tasks
- events
- inbox items
- agent events
- chat history
- settings

Derived:

- source chunks when they can be rebuilt from source bodies
- FTS rows
- embedding vectors
- denormalized search rows
- transient import/extraction queues

When a derived table cannot be rebuilt, promote it to durable in docs and tests.

## IDs and Time

- Use sortable `TEXT` IDs, such as ULIDs or UUIDv7-style IDs.
- Store timestamps as ISO-8601 `TEXT`.
- Normalize casing at application boundaries.
- Store flexible fields as JSON text and validate with Zod before use in TypeScript.

## Privacy

Every retrieval path must understand privacy.

Default privacy values:

- `local`
- `cloud_allowed`
- `sensitive`
- `never_external`

Cloud model calls must exclude `never_external` context. `sensitive` context requires an
explicit policy or user approval before cloud use.

## UI

The main UI is not a database browser. Build around:

- Today
- Inbox
- Ask/Search
- Entities
- Settings

Raw table inspection may be added later behind an advanced/developer surface.

## Agent Contract

The CLI is the first stable contract. Skills should call `brain` commands rather than
write SQL directly.

Agent writes must be audited in `agent_events` and should default to suggested memory or
review inbox items.

## Testing

Plans should include:

- migration tests,
- typed query tests,
- retrieval/privacy tests,
- CLI JSON contract tests,
- UI smoke tests for the core surfaces.

Run `pnpm check` and relevant Cargo checks before declaring implementation work done.
