# Plan 06 - Search, Retrieval, and AI

**Goal:** Provide fast local search, grounded Chat, model-backed extraction, and
agent-readable report generation over the personal-CRM records.

**Depends on:** Plans 01-05.

**Unlocks:** Plans 07-09.

## Scope

**In:** FTS5, optional vector search, retrieval policy, citations, record lookup,
Chat conversations, daily report/todo retrieval, and model boundary settings.

**Out:** hosted sync, browser extension search, automatic external app connectors.

## Key Decisions

- FTS5 is the first search path.
- Embeddings are additive and optional until packaging and speed are proven.
- Global search ranks visible records, including assets.
- Global search accepts a small tag grammar: ordinary text searches names, FTS
  bodies, assets, and matching tag names/slugs; `#tag-slug` filters results to
  records carrying that tag, with multiple tags ANDed.
- Grounded discovery ranks unique visible records by fusing exact name/title and
  typed-field matches with lexical and semantic chunk matches. A long source must
  not consume the result budget with many chunks from the same record.
- Evidence selection de-duplicates byte-identical and normalized-equivalent passages
  within a record before applying its two-passage cap. Multi-term coverage and explicit
  answer-bearing values outrank repeated quoted history; semantic per-record caps count
  unique passages rather than raw vector neighbours.
- Chunk retrieval remains available through `retrieve()`. Grounded Chat uses a sibling
  record-candidate path: it shares the chunk joins, visibility/date filters, and
  semantic primitives with `retrieve()`, then fuses those results with typed record
  fields at record granularity. It does not call or wrap `retrieve()`.
- `content_chunks` is a transactionally maintained projection of durable record text.
  App writes maintain document, interaction, memory, and profile-bearing person/
  organization projections; CLI import and enrichment paths additionally project their
  supported entity text. Creating or correcting projected text updates chunks and
  hashes in the same transaction.
- Chat persists conversations and AI SDK message JSON in SQLite, but retrieved Chat
  tool results are provenance for the local conversation trace, not `evidence_refs`.
  Prior raw results are elided before a later provider request. Chat citations use
  stable record/chunk refs returned by the same assistant turn; unseen refs are never
  made navigable.
- Chat can perform core CRM writes only through user-approved AI SDK write tools.
- A Chat turn captures the active brain's database path and connection generation.
  Reads are rejected if that identity changes, and native writes/approvals are pinned
  to it so a brain switch cannot redirect an in-flight operation.
- Extracted memories and tasks cite `content_chunks` through `evidence_refs`.
- Daily reports and todo lists should use retrieval/citation machinery where useful.
- Settings controls AI providers.
- There is no row-level sensitivity label schema for launch.

## Reflect Open Patterns To Reuse

- Command/search is one surface: find, navigate, and run commands from the same palette.
- FTS uses title/body weighting, snippets, small result caps, and no filesystem scan.
- Embeddings run locally in Rust, off the UI thread, with lexical fallback.
- Search paths share the same durable chunks, typed joins, filters, and embedding
  projection rather than maintaining an AI-only index.
- Hybrid results collapse to record granularity before fusion and carry only a small
  bounded set of evidence chunks for follow-up reads.
- AI context assembly is transparent; extraction uses durable evidence refs, while
  Chat keeps tool provenance in its local trace and does not resend old raw payloads.
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
   - assets
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
4. Add FTS over `content_chunks.text`, document/interaction title/body text, and asset
   metadata/text.
   - use `unicode61` initially
   - rank with title/name boosts where applicable
   - return snippets for chunk hits
   - keep first-wave filters intentionally small
5. Add ranking that combines:
   - exact name/title promotion
   - rank-based lexical + semantic fusion
   - recency as a tie-break unless chronological ordering is explicitly requested
6. Embedding generation for chunks (shipped — see `docs/reflect-embeddings/`):
   - paragraph-aware chunking in `packages/core` (`ingest/chunk.ts`); vectors are a
     rebuildable projection over the durable `content_chunks` table
   - `fastembed` runtime in Rust (`all-MiniLM-L6-v2`, 384-dim), desktop only
   - model downloaded on demand into app data (never bundled), progress polled
   - vectors stored in `sqlite-vec` (`chunk_embeddings` + `chunk_vectors` vec0, cosine)
   - chunk text hashes skip unchanged work; a hash/model mismatch is excluded from
     semantic reads immediately, then replaced or pruned asynchronously
   - successful in-app writes trigger incremental catch-up; a cheap periodic status
     check every 60 seconds discovers CLI/external writes while the app remains open
   - failure means semantic unavailable, not app failure (lexical fallback)
7. Add retrieval API for agent and Chat workflows:
   - question
   - selected filters/context
   - ranked chunks
   - linked records
   - mode: lexical, semantic, or hybrid
   - citations/evidence payload
   - one candidate per record, with at most the best few evidence chunks
   - typed relationship filters for people, organizations, projects, tasks,
     documents, and interactions
   - semantic KNN overfetch that expands geometrically to a bounded ceiling when typed
     filters or one long source leave too few unique records; this improves diversity
     without claiming exhaustive filtered KNN recall
8. Build Chat:
   - top-level route and sidebar item
   - durable chat conversations and messages in SQLite
   - sidebar titles generated from the first turn when an AI provider is available,
     with the first user prompt as an immediate fallback
   - Vercel AI SDK client-side streaming with BYOK provider keys fetched from the
     keychain per request
   - tool calls and results persisted in local message JSON for an inspectable trace;
     prior turns retain call/result shape but raw results are elided from later model
     requests
   - a compact per-turn brain overview supplies record counts, date span, active
     projects, self identity, and bounded real filter vocabularies
   - old bulky tool results are elided and old turns dropped as whole units before a
     provider context window is exceeded
   - factual turns use at most four model steps, including a synthesis-only final step;
     approved write workflows retain the larger multi-step allowance they need
   - search and browse share a two-call discovery budget, with 12 results by default
     and 16 maximum; factual turns may load one detail batch containing at most six
     unique records and 24,000 text characters; once `get_records` returns bounded
     details, earlier candidate payloads are elided from the provider request
   - the final allowed model step cannot call another tool, so a turn ends with a
     synthesized answer instead of tool activity alone
   - returned record titles are inspectable in the tool trace; validated record/chunk
     citations open either the record or a derived existing parent route (for example,
     a transcript opens its interaction) when one exists
   - all turn reads, conversation persistence, title generation, and approved writes
     remain bound to the brain identity captured when the turn began
   - approval identity stays process-local rather than entering Chat JSON; after reload
     a pending approval may be dismissed but must be retried before it can execute
   - write tools for core CRM records require explicit user approval before mutation
9. Add model boundary checks:
   - require configured key or local model
   - show when external calls are disabled
   - include only source text needed for extraction
   - construct external model context through one checked helper/type
10. Add retrieval endpoints for agent workflows:
   - daily report
   - todo list
   - changed records since timestamp
   - waiting items
11. Add graph data endpoint:
   - centered on the user's own person row
   - returns typed nodes and weighted edges

## Acceptance Criteria

- Global search finds records by name, title, and body text.
- Global search finds records by tag name/slug, and `#tag` narrows results to
  tagged navigable records without adding a separate filter UI.
- Global search finds assets by filename, MIME/kind/storage metadata, original URL,
  link captions, linked record titles, and optional local asset text.
- Cmd/Ctrl+K provides one keyboard-native surface for find, navigate, and command
  execution.
- Chat can answer questions using local typed records and evidence chunks, and its
  conversations survive relaunch.
- Chat finds title-only, summary-only, and typed CRM records without requiring a
  synthetic chunk, and source edits cannot leave stale chunk text searchable.
- One long document or transcript cannot crowd other relevant records out of the
  candidate list.
- Repeated quoted chunks cannot fill a record's evidence slots or semantic per-record
  allowance, and an explicit answer-bearing passage survives for the detail read.
- A factual Chat turn cannot exceed two discovery calls, one six-record/24,000-character
  detail batch, or four model steps, and its final step is reserved for synthesis.
- Every explicitly requested evidence chunk survives the detail-read budget before
  neighboring context is added.
- A Chat citation is clickable only when its record (and optional chunk) was returned
  by a read tool in that assistant turn.
- Switching brains during a Chat turn or while an approval is pending cannot expose or
  persist the old turn in the new brain.
- Chat can create or update people, organizations, projects, tasks, interactions, and
  memories only after the user approves the specific tool call.
- An agent can request enough structured context to generate a daily report and todo
  list.
- Daily brief retrieval includes relationship-linked waiting items, recent
  interactions, and upcoming important dates.
- Graph data can be generated from durable typed records without a separate graph table.
- Asset search is navigational; factual report citations still come from
  document/interaction chunks.
- Semantic search can be unavailable while lexical search still works.
- The app behaves clearly when no AI provider or local model is configured.

## Tests or Verification

- Unit test search ranking inputs.
- Integration test FTS indexing and rebuild.
- Unit test command registry execution and keyboard-result behavior.
- Unit test chunk hash stability and lexical fallback when embeddings are unavailable.
- Real-SQLite golden tests cover title/summary/typed-field recall, record-level
  diversity, duplicate quoted-history evidence, answer-bearing passage selection,
  relationship filtering, source-edit freshness, and chronological browse.
- Unit test context-window trimming, final-step synthesis, batched record reads, and
  unsupported citation refs.
- Integration test cited task/memory evidence persistence.
- Render test Chat empty/no-provider states and unit test the client transport with
  mocked retrieval, keychain, and AI SDK streaming.

## Open Questions

- The embedding backend is `fastembed` + `sqlite-vec` (see `docs/reflect-embeddings/`).
  Bundling/notarizing the ONNX runtime and the on-demand model download still need a
  packaging pass (Plan 09); the runtime degrades to lexical if unavailable.
- Semantic search is desktop-only for now — the `brain` CLI's search stays lexical (no
  embedding runtime in the CLI binary).
- Graph data filters by node type, date range, project, and relationship strength are
  optional follow-up.
