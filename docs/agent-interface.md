# Agent Interface

Local Brain is primarily operated by local agents. The first agent contract is a
`brain` CLI plus a local Codex skill.

The desktop UI exists, but agents should not scrape it. A Codex daily automation should
be able to update the brain, generate a report, and produce a todo list through the CLI
or approved local database access.

## Principles

- Query before writing.
- Write typed records: documents, interactions, tasks, and hidden memories.
- Use people, organizations, projects, and tasks as the main links.
- Store readable imported text in SQLite through the CLI.
- Preserve provenance directly on documents, interactions, tasks, memories, and
  evidence references.
- Prefer cited answers over uncited summaries.
- Never invent context. Add uncertain details as low-confidence memories or skip them.

## Example Commands

Status and diagnostics:

```bash
brain status
brain doctor --json
brain path
```

Add records:

```bash
brain add document --title "Kitchen remodel notes" --text-file notes.md
brain add interaction --kind meeting --title "Call with Maya" --text-file transcript.txt
brain add task --title "Send Maya the revised budget" --project "Kitchen remodel"
brain remember --kind decision --claim "Maya approved the revised budget range" --link person:maya
```

Query records:

```bash
brain search "revised budget"
brain ask "What did I promise Maya last week?"
brain today --json
brain report daily --json
brain tasks plan-day --json
brain graph --center self --json
brain show person maya --json
brain show project "Kitchen remodel"
```

## Document Versus Interaction

Use a document for user-readable reference material:

- notes
- PDFs and text files
- specs and plans
- webpages
- receipts
- long-form reference text

Use an interaction for a human exchange:

- meeting transcript
- call transcript
- email body or thread
- message thread
- chat transcript
- voice note
- event notes

## Agent Write Rules

Before adding a record:

1. Search for likely duplicates.
2. Reuse existing people, organizations, projects, and tasks when possible.
3. Include title, kind, date, and provenance metadata when known.
4. Link the new record to relevant people, organizations, projects, or tasks.
5. Let extraction create hidden memories unless the agent has an explicit atomic claim
   to store.

When adding a memory:

- Keep it atomic.
- Use one of: fact, preference, decision, commitment, instruction, risk, idea.
- Link it to visible records.
- Add evidence when the claim came from a document or interaction.

## Skill Contract

The local skill should teach agents:

- the product nouns,
- when to create documents versus interactions,
- how to query before writing,
- how to add tasks and memories,
- how to run daily update/report/todo workflows,
- how to query the user-centered graph,
- how to request JSON output,
- how to cite evidence,
- how to avoid duplicate records.

Agents should treat the CLI as the main supported operating path for launch.
