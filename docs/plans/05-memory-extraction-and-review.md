# Plan 05 - Memory Extraction and Review

**Goal:** Turn sources into candidate memories, entities, tasks, events, and
relationships, then let the user review uncertain changes.

**Depends on:** Plan 02, Plan 04.

**Unlocks:** Plan 03 richer UI states, Plan 06 retrieval, Plan 07 agent writes, Plan 08
deletion semantics.

## Scope

**In:** extraction pipeline, candidate records, inbox review workflow, entity matching,
task/event suggestions, agent event audit.

**Out:** full email/calendar integrations, complex ontology, automatic confirmed memory
for low-confidence claims.

## Key Decisions

- Memories are extracted beliefs, not raw evidence.
- The default extraction output status is `suggested`.
- Confirmed memories require explicit user acceptance or a high-confidence rule defined
  in code.
- Generic `entities` remain the primary model; do not add typed people/org/project
  tables.
- Contradictory or uncertain facts should become review items, not hidden overwrites.

## Implementation Steps

1. Define extraction result schemas in `packages/core` using Zod.
2. Add a deterministic extraction adapter interface so local rules and model-backed
   extraction can share the same output shape.
3. Start with local/rule-based extraction for obvious tasks, dates, and simple entity
   mentions where practical.
4. Add BYOK model-backed extraction behind explicit settings once provider keys exist.
5. Match extracted entities against aliases and canonical keys.
6. Write candidate memories, entities, tasks, events, and relationships transactionally.
7. Create inbox items for suggestions, entity merges, privacy review, and contradictions.
8. Build review actions: accept, reject, edit, merge entity, and archive.
9. Record extraction runs and writes in `agent_events`.

## Acceptance Criteria

- Ingested sources can produce candidate memories and entities.
- Suggested memories are visible in Inbox before becoming trusted context.
- Accepting a suggestion updates status and removes/resolves the inbox item.
- Rejecting a suggestion keeps an audit trail without polluting confirmed recall.
- Entity matching prevents obvious duplicate people/projects/topics.
- Tasks and events can be extracted as suggestions.

## Tests or Verification

- Unit tests for extraction output validation.
- Tests for entity canonicalization and alias matching.
- Transaction tests for accepting/rejecting inbox items.
- UI tests for reviewing a memory suggestion and an entity merge suggestion.
- Regression test that durable sources remain intact when derived suggestions are
  rejected.

## Open Questions

- Exact model provider for extraction is undecided. Default to adapter interfaces and
  no hosted Local Brain API.
