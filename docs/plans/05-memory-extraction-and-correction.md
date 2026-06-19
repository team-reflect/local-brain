# Plan 05 - Memory Extraction and Linking

**Goal:** Extract useful structured context from documents and interactions without
creating a mandatory review queue.

**Depends on:** Plans 01-04.

**Unlocks:** Plans 06-08.

## Scope

**In:** extraction prompts/pipelines, candidate people and organizations, project and
task detection, hidden atomic memories, evidence refs, link creation, correction from
detail pages.

**Out:** automatic inbox review, hosted extraction service, email/calendar sync.

## Key Decisions

- Extraction writes visible records when confidence is high enough.
- Low-confidence extracted links can remain suggestions in the relevant detail context,
  but there is no global review queue.
- Memories are hidden atomic claims, not a sidebar surface.
- Memories link to visible records through `memory_links`.
- Memories and extracted tasks cite evidence through `evidence_refs`.
- Agent-authored transcript memories and follow-up tasks can cite exact chunks through
  CLI evidence refs such as `interaction:<id>#0`; model extraction uses the same
  `evidence_refs` table.
- Corrections happen where the user notices them: person, organization, project, task,
  document, or interaction views.

## Implementation Steps

1. Define extraction outputs:
   - people
   - organizations
   - affiliations
   - projects
   - tasks
   - memories
   - record links
   - evidence refs
2. Build deterministic pre-processing:
   - chunk selection
   - date extraction
   - sender/participant hints
   - duplicate candidate lookup
3. Build model extraction for documents and interactions.
4. Add merge/upsert logic for people and organizations.
5. Add task extraction with status, due date, project/person/org links, and evidence.
6. Add memory extraction for facts, preferences, decisions, commitments, instructions,
   risks, and ideas.
7. Link memories to relevant people, organizations, projects, tasks, documents, and
   interactions.
8. Add correction flows:
   - unlink wrong person/org/project/task
   - edit extracted task
   - archive or edit memory
   - fix citation/evidence link
9. Update relationship-intelligence hints from interactions and tasks:
   - last interaction date
   - reconnect suggestions
   - relationship strength as a deterministic SELECT-only projection
   - important dates
10. Add extraction job status on the imported record or job table if needed for UI
   progress.

## Acceptance Criteria

- A meeting transcript can create or update people, organizations, tasks, projects,
  and hidden memories.
- Extracted tasks and memories cite chunks from the originating document or
  interaction.
- The user can correct wrong links from the affected detail page.
- There is no mandatory extraction review inbox.
- The system avoids obvious duplicates for people, organizations, and tasks.
- Relationship follow-up hints update after relevant interactions.

## Tests or Verification

- Unit test merge/upsert matching.
- Unit test task and memory evidence creation.
- Golden tests for representative meeting, email, note, and document inputs.
- Manual test: import text, inspect Today/Tasks/Network/Projects, correct one mistake.

## Open Questions

- Whether extraction runs fully locally or via BYOK model adapters can be finalized
  when model quality and speed are tested.
