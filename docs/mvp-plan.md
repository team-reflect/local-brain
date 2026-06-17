# MVP Plan

The first version should prove the core loop:

> Add sources. Extract memories. Review them. Ask useful questions. Let local agents use
> the same memory.

## Phase 1: Docs and Schema

- Product thesis.
- Reflect Open technology mapping.
- SQLite launch schema.
- CLI and skill contract.
- Open questions.

## Phase 2: Skeleton App

- Tauri desktop app.
- React UI.
- Rust SQLite layer.
- Kysely query bridge.
- SQLite migrations and generated types.
- OS keychain integration for model keys.
- `brain` CLI sidecar.

## Phase 3: Manual Sources

Support only simple ingestion:

- paste text,
- markdown/plain text files,
- transcript files,
- folder import.

No email, calendar, browser, or account integrations yet.

## Phase 4: Extraction Pipeline

For each source:

1. Chunk source.
2. Index with FTS5.
3. Generate local embeddings if available.
4. Extract candidate memories, entities, tasks, events, and relationships.
5. Put uncertain changes into the inbox.
6. Let the user accept, reject, edit, or merge.

## Phase 5: Useful UI

Only three primary surfaces:

- **Today:** open tasks, upcoming events, recent memories, follow-ups, review queue.
- **Ask/Search:** natural language search and answers with citations.
- **Entities:** pages for people, projects, organizations, topics, and places.

Advanced database inspection can come later behind a developer toggle.

## Phase 6: Local Agent Integration

- Install `brain` CLI.
- Install one Codex skill.
- Add commands for search, remember, ingest, today, and entity context.
- Audit agent writes in `agent_events`.

## Launch Criteria

The product is launchable when a technical user can:

- import a folder of notes or transcripts,
- see suggested memories in an inbox,
- confirm and edit memories,
- ask questions with citations,
- see a useful Today view,
- install a local agent skill,
- have an agent remember something,
- export the SQLite DB and JSON backup,
- understand what, if anything, was sent to a cloud model.

## Things to Avoid in V1

- Full email ingestion.
- Calendar OAuth.
- Browser extension.
- Mobile.
- Hosted sync.
- Collaboration.
- Generic database editor as the main UI.
- Complex ontologies.
- Marketplace/plugin system.

These can all be good later. They are distracting before the local memory loop works.
