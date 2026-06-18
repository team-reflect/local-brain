# Plan 06 - Search, Retrieval, and AI

**Goal:** Provide fast local search, cited AI answers, and agent-readable report
generation over the personal-CRM records.

**Depends on:** Plans 01-05.

**Unlocks:** Plans 07-09.

## Scope

**In:** FTS5, optional vector search, retrieval policy, Ask conversations, citations,
answer persistence, record lookup, daily report/todo retrieval, model boundary
settings.

**Out:** hosted sync, browser extension search, automatic external app connectors.

## Key Decisions

- FTS5 is the first search path.
- Embeddings are additive and optional until packaging and speed are proven.
- Retrieval ranks visible records and chunks from documents and interactions.
- One `retrieve()` API serves Ask, daily reports, graph context, search enrichment, and
  CLI reads.
- AI answers cite `content_chunks` through `evidence_refs`.
- Chat history lives in `chat_conversations` and `chat_messages`.
- Daily reports and todo lists should use the same retrieval/citation machinery as Ask.
- Settings controls model keys and whether external model calls are enabled.
- There is no row-level sensitivity label schema for launch.

## Reflect Open Patterns To Reuse

- Command/search is one surface: find, navigate, and run commands from the same palette.
- FTS uses title/body weighting, snippets, small result caps, and no filesystem scan.
- Embeddings run locally in Rust, off the UI thread, with lexical fallback.
- Hybrid retrieval uses one shared contract rather than separate AI/search indexes.
- AI context assembly is transparent and cited.
- External model payloads pass through one typed boundary so unchecked context cannot be
  sent accidentally.

## Implementation Steps

1. Add global search over:
   - people
   - organizations
   - projects
   - tasks
   - documents
   - interactions
2. Add a command/search palette:
   - Cmd/Ctrl+K opens instantly
   - empty query shows recent/active records and useful commands
   - typed query searches records and chunks
   - `>` prefix or a similar convention filters to commands
   - Enter opens a record or runs a command
3. Add a typed command registry shared by palette, deep links, and CLI parity tests:
   - go to Today
   - create document
   - create interaction
   - create task
   - open Graph
   - run daily report
   - rebuild derived indexes
4. Add FTS over `content_chunks.text` and visible record titles/names.
   - use `unicode61` initially
   - rank with title/name boosts where applicable
   - return snippets for chunk hits
   - keep first-wave filters intentionally small
5. Add ranking that combines:
   - lexical match
   - recency
   - explicit links to active projects/tasks
   - selected current view context
6. Embedding generation for chunks (shipped — see `docs/reflect-embeddings/`):
   - paragraph-aware chunking in `packages/core` (`ingest/chunk.ts`); vectors are a
     rebuildable projection over the durable `content_chunks` table
   - `fastembed` runtime in Rust (`all-MiniLM-L6-v2`, 384-dim), desktop only
   - model downloaded on demand into app data (never bundled), progress polled
   - vectors stored in `sqlite-vec` (`chunk_embeddings` + `chunk_vectors` vec0, cosine)
   - chunk text hashes skip unchanged work; a model change re-embeds
   - failure means semantic unavailable, not app failure (lexical fallback)
7. Add retrieval API for Ask and agent workflows:
   - question
   - selected filters/context
   - ranked chunks
   - linked records
   - mode: lexical, semantic, or hybrid
   - citations/evidence payload
8. Build Ask answer generation with citations.
9. Persist conversations and messages.
10. Create `evidence_refs` for assistant messages.
11. Add model boundary checks:
   - require configured key or local model
   - show when external calls are disabled
   - include only retrieved text needed for the answer
   - construct external model context through one checked helper/type
   - log/model usage metadata in chat message metadata if useful
12. Add cited-answer UI:
   - answer text
   - citation list
   - jump to document or interaction
   - show linked people, organizations, projects, and tasks
13. Add retrieval endpoints for agent workflows:
   - daily report
   - todo list
   - changed records since timestamp
   - waiting items
   - relationship follow-ups
14. Add graph data endpoint:
   - centered on the user's own person row
   - returns typed nodes and weighted edges

## Acceptance Criteria

- Global search finds records by name, title, and body text.
- Cmd/Ctrl+K provides one keyboard-native surface for find, navigate, and command
  execution.
- Ask can answer a question using local documents and interactions.
- Every factual Ask answer shows citations.
- Citations open the exact document or interaction context.
- Chat history is persisted.
- An agent can request enough structured context to generate a daily report and todo
  list.
- Daily brief retrieval includes relationship follow-ups, stale relationships, and
  upcoming important dates.
- Graph data can be generated from durable typed records without a separate graph table.
- Search and Ask both use the same retrieval contract.
- Semantic search can be unavailable while lexical search still works.
- The app behaves clearly when no model key or local model is configured.

## Tests or Verification

- Unit test search ranking inputs.
- Integration test FTS indexing and rebuild.
- Unit test command registry execution and keyboard-result behavior.
- Unit test chunk hash stability and lexical fallback when embeddings are unavailable.
- Integration test cited answer persistence.
- Manual test Ask across a seeded person, project, task, document, and interaction.

## Open Questions

- The embedding backend is `fastembed` + `sqlite-vec` (see `docs/reflect-embeddings/`).
  Bundling/notarizing the ONNX runtime and the on-demand model download still need a
  packaging pass (Plan 09); the runtime degrades to lexical if unavailable.
- Semantic search is desktop-only for now — the `brain` CLI's search/ask stay lexical
  (no embedding runtime in the CLI binary).
- Graph data filters by node type, date range, project, and relationship strength are
  optional follow-up.
