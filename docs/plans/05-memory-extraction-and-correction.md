# Plan 05 - Memory Extraction and Correction

**Goal:** Turn sources into useful memories, entities, tasks, events, and relationships
automatically, while making correction, deletion, and audit easy.

**Depends on:** Plan 02, Plan 04.

**Unlocks:** Plan 03 richer UI states, Plan 06 retrieval, Plan 07 agent writes, Plan 08
deletion semantics.

## Scope

**In:** extraction pipeline, direct memory writes, entity matching, task/event
extraction, correction flows, provenance metadata.

**Out:** full email/calendar integrations, complex ontology, and default triage queues.

## Key Decisions

- Memories are extracted beliefs, not raw evidence.
- The default extraction output status is `active`.
- AI extraction writes directly when useful.
- Generic `entities` remain the primary model; do not add typed people/org/project
  tables.
- Contradictory or lower-confidence facts should preserve confidence and provenance
  instead of blocking behind review.
- The user corrects memory from the place they encounter it: source detail, entity page,
  Today, Ask/Search citations, or memory detail.

## Implementation Steps

1. Define extraction result schemas in `packages/core` using Zod.
2. Add a deterministic extraction adapter interface so local rules and model-backed
   extraction can share the same output shape.
3. Start with local/rule-based extraction for obvious tasks, dates, and simple entity
   mentions where practical.
4. Add BYOK model-backed extraction behind explicit settings once provider keys exist.
5. Match extracted entities against aliases and canonical keys.
6. Write active memories, entities, tasks, events, and relationships transactionally.
7. Store confidence, source excerpt, extraction metadata, and creator metadata.
8. Build correction actions: edit memory, mark stale, archive, delete, merge entity, and
   unlink a bad relationship.
9. Ensure extracted records can be traced back to the source and extraction metadata.

## Acceptance Criteria

- Ingested sources can produce active memories and entities.
- Extracted memories are usable immediately in search and entity pages.
- Users can correct, archive, delete, or mark memories stale.
- Corrections preserve provenance and history.
- Entity matching prevents obvious duplicate people/projects/topics.
- Tasks and events can be extracted directly.

## Tests or Verification

- Unit tests for extraction output validation.
- Tests for entity canonicalization and alias matching.
- Transaction tests for memory correction, archival, deletion, and entity merge.
- UI tests for correcting a memory from source detail, entity page, and citation detail.
- Regression test that durable sources remain intact when extracted memories are
  corrected or deleted.

## Open Questions

- Exact model provider for extraction is undecided. Default to adapter interfaces and
  no hosted Local Brain API.
