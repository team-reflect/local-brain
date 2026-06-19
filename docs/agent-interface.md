# Agent Interface

Local Brain is primarily operated by local agents. The first agent contract is a
`brain` CLI plus a local Codex skill.

The desktop UI exists, but agents should not scrape it. A Codex daily automation should
be able to update the brain, generate a report, and produce a todo list through the CLI
or approved local database access.

## Principles

- Query before writing.
- Write typed records: people, documents, interactions, assets, tasks, and hidden memories.
- Use people, organizations, projects, and tasks as the main links.
- Store readable imported text in SQLite through the CLI.
- Store binary assets through CLI file import so SQLite can record metadata and typed
  links while bytes stay in the app-managed `assets/` directory.
- Keep imports provider-neutral: upstream tools translate source records into generic
  `brain` CLI calls.
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
brain source ensure --slug gmail --name "Gmail" --json
```

Add records:

```bash
brain add person --full-name "Maya Chen" --email maya@example.com
brain add person-from-email --full-name "Maya Chen" --email maya@example.com --source gmail --external-id msg-123 --json
brain add document --title "Kitchen remodel notes" --text-file notes.md
brain add interaction --kind meeting --title "Call with Maya" --text-file transcript.txt
brain add interaction --kind email --title "Email from Maya" --text-file body.txt --source gmail --external-id msg-123 --participant "from:Maya Chen <maya@example.com>" --json
brain add asset --file maya.jpg --link person:maya --role avatar
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

Use an asset for binary supporting material:

- avatars and logos
- screenshots and images
- original attachments whose readable text is stored separately
- source files that should remain inspectable beside the database

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

When adding a person:

- Use the generic CLI person command for explicit contact imports, regardless of source
  (Google Contacts, vCard, CSV, or manual user instruction).
- Include stable contact fields when known: full name, preferred name, emails, phones,
  headline, location, summary, notes, and reconnect cadence.
- Use `--source`, `--external-id`, and contact handles for idempotent import. The CLI
  resolves first by external identity, then email handle, then normalized name.
- Use `brain add person-from-email` for untrusted sender/display-name pairs. It skips
  machine senders, no-reply addresses, token-looking names, invalid emails, and
  email-as-name values with structured JSON reason codes.
- Do not teach the `brain` CLI about any upstream provider. Agents translate source
  records into Local Brain's typed person fields before writing.

When importing emails or calendar events:

- Store readable body text as an interaction.
- Pass provider identity through generic `--source` and `--external-id`.
- Preserve raw unresolved participants with repeatable `--participant` values such as
  `from:Robin Spencer <robin@example.com>`; do not create people for every handle.
- Store binary attachments through `brain add asset --link interaction:<id>`.

When adding an asset:

- Import from a local file path; do not inline base64 in document text.
- Link it to a typed record with a role such as avatar, logo, attachment, inline_image,
  screenshot, or source_file.
- Preserve original filename, original path, URL, MIME type, size, and content hash when
  available.

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
- how to add and link binary assets,
- how to run provider-neutral email/contact imports,
- how to run daily update/report/todo workflows,
- how to query the user-centered graph,
- how to request JSON output,
- how to cite evidence,
- how to avoid duplicate records.

Agents should treat the CLI as the main supported operating path for launch.
