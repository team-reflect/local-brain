# Plan 06 - Search, Retrieval, and AI

**Goal:** Provide fast lexical search, privacy-aware retrieval, optional local
embeddings, and cited answers over local memory.

**Depends on:** Plan 02, Plan 04, Plan 05.

**Unlocks:** Plan 03 Ask/Search completion, Plan 07 CLI ask/search, Plan 08 privacy
audit, Plan 09 launch quality.

## Scope

**In:** FTS5 search, retrieval ranking, citation bundles, privacy filtering, chat
history, BYOK/local model adapters, optional vector search.

**Out:** hosted model proxy, web search, broad plugin system, mobile AI.

## Key Decisions

- FTS5 search ships before vector search if vector packaging is risky.
- Local embeddings are preferred for semantic retrieval when distribution is reliable.
- Generative AI uses user-approved local or BYOK providers.
- Retrieval must filter context before any cloud model call.
- Answers must cite sources and memories used.
- Chat history is durable SQLite data.

## Implementation Steps

1. Implement FTS5 indexing and rebuild helpers for sources, memories, entities, and
   tasks.
2. Build search APIs that return typed result objects with target type, title, snippet,
   timestamp, privacy, and citation metadata.
3. Build retrieval APIs that assemble context bundles from sources, chunks, memories,
   tasks, events, and entities.
4. Add privacy policy filters for local-only and cloud-allowed retrieval modes.
5. Add chat conversation/message persistence.
6. Add model provider settings and keychain-backed secrets.
7. Add Ask/Search UI that shows answers, citations, and whether context left the
   machine.
8. Add optional local embedding pipeline and vector table integration when stable.

## Acceptance Criteria

- Users can search sources, memories, entities, and tasks from one query box.
- Ask/Search can answer with citations from local context.
- The user can see which sources and memories were used.
- `never_external` context is excluded from cloud model calls.
- Chat history survives relaunch.
- If embeddings are unavailable, FTS retrieval still works.

## Tests or Verification

- FTS fixture tests for source/memory/entity/task matches.
- Retrieval tests for privacy filtering across local-only and cloud modes.
- Chat persistence tests.
- Provider adapter tests using mocked model responses.
- UI tests for citations and context-left-machine indicators.

## Open Questions

- Exact first embedding runtime/model is undecided. Default to Reflect Open's local
  Rust embedding direction when feasible.
