# Agent Interface

Local Brain is primarily operated by local agents. The first agent contract is a
`brain` CLI plus a local agent skill.

The desktop UI exists, but agents should not scrape it. A local agent automation should
be able to update the brain, generate a report, and produce a todo list through the CLI
or approved local database access.

## Principles

- Query before writing.
- Write typed records: people, documents, interactions, assets, tasks, and hidden memories.
- Use people, organizations, projects, and tasks as the main links.
- Store readable imported text in SQLite through the CLI.
- Store binary assets through CLI file import so SQLite can record metadata and typed
  links while bytes stay in the app-managed `assets/` directory.
- Store asset-derived plain text in `asset_texts` when an importer already has it.
  Text-like UTF-8 files can be indexed locally; PDFs/images remain metadata-searchable
  until a later OCR/local extraction pass.
- Keep imports provider-neutral: upstream tools translate source records into generic
  `brain` CLI calls.
- Preserve provenance directly on documents, interactions, tasks, memories, and
  evidence references.
- Treat `brain --json contract` as the discoverable source of truth for command shapes,
  link syntax, source identity rules, exit codes, and import mappings.
- In `--json` mode, parse command failures from JSON on stderr:
  `{ ok: false, error: { kind, message, exitCode } }`.
- Prefer cited records and evidence over uncited summaries.
- Never invent context. Add uncertain details as low-confidence memories or skip them.

## Example Commands

Status and diagnostics:

```bash
brain --json contract
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
brain add interaction --kind email --title "Everlywell Integration" --text-file digest.md --summary "Production credential setup and go-live readiness." --source gmail --external-kind thread --external-id thread-123 --json
brain add interaction --kind meeting --title "Granola: Northwind kickoff" --text-file transcript.txt --summary "Kickoff decisions and follow-ups." --source granola --external-id meeting-123 --replace-body --json
brain add interaction --kind event --title "Calendar: Hotel stay" --occurred-at 2026-07-09 --ended-at 2026-07-12 --location "Louma" --source google_calendar --external-id event-123 --self-participant "attendee:You <alex@example.com>" --json
brain add project --name "Kitchen remodel" --summary "Budget, contractor, and cabinet decision context." --json
brain add asset --file maya.jpg --link person:maya --role avatar
brain add asset --file invoice.pdf --link interaction:email-id --text-file extracted.txt --text-source importer --json
brain asset text set asset-id --text-file - --source importer --json
brain add task --title "Send Maya the revised budget" --link project:<id>
brain add task --title "Send cardiologist shortlist to Dr. Vargas" --link interaction:<id> --link project:<id> --link person:<id> --evidence interaction:<id>#0 --json
brain remember --kind decision --claim "Maya approved the revised budget range" --link person:maya --link interaction:<id> --evidence interaction:<id>#0
```

Query records:

```bash
brain search "revised budget"
brain today --json
brain report daily --json
brain tasks plan-day --json
brain graph --center self --json
brain show person maya --json
brain show asset asset-id --json
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
3. Include title, kind, date, and provenance metadata when known. For source-backed
   imports, use the correct external identity scope, such as Gmail `--external-kind
   thread` versus `message`.
4. Link the new record to relevant people, organizations, projects, or tasks. Projects
   are manually curated user structure: search existing projects and link clear
   matches, but do not auto-create projects during import or extraction.
5. When a task or memory is derived from a source record, cite the exact source chunk
   with `--evidence document:<id>#<chunk>` or `--evidence interaction:<id>#<chunk>`.
6. Let extraction create hidden memories unless the agent has an explicit atomic claim
   to store.

When adding a person:

- Use the generic CLI person command for explicit contact imports, regardless of source
  (Google Contacts, vCard, CSV, or manual user instruction).
- Include stable contact fields when known: full name, preferred name, emails, phones,
  headline, location, summary, and notes.
- Use `--source`, `--external-id`, and contact handles for idempotent import. The CLI
  resolves first by external identity, then email handle, then normalized name.
- Use `brain add person-from-email` for untrusted sender/display-name pairs. It skips
  machine senders, no-reply addresses, token-looking names, invalid emails, and
  email-as-name values with structured JSON reason codes.
- Do not teach the `brain` CLI about any upstream provider. Agents translate source
  records into Local Brain's typed person fields before writing.

When importing emails or calendar events:

- Store readable body text as an interaction.
- Prefer thread-level digests for long Gmail conversations; store raw message-level
  bodies only when the message is standalone and safe.
- Use `--summary` for a compact redacted import summary, while still passing
  `--text-file` or `--text` for searchable body/digest text.
- Pass provider identity through generic `--source` and `--external-id`.
- For calendar events, map structured fields onto the interaction before notes:
  `--occurred-at` for start, `--ended-at` for end, `--location` for venue or
  address, and `--original-url` for the provider event URL.
- Use `--kind meeting` for people-centered calendar items and `--kind event` for
  travel, lodging, reservations, reminders, and all-day schedule blocks, even when
  they have attendees.
- Link known people with `--link person:<id>` when the importer has already resolved
  them. Raw participant email handles that match existing people are also resolved by
  the CLI.
- Preserve raw unresolved participants with repeatable `--participant` values such as
  `from:Robin Spencer <robin@example.com>`; do not create people for every handle.
- Use `--self-participant` for attendee rows the upstream provider marks as the user.
- Keep notes for source-specific details that do not have typed Local Brain fields,
  not as the primary storage for start/end/location/attendee data.
- Calendar items with a title and structured fields may omit `--text` / `--text-file`.
- Store binary attachments through `brain add asset --link interaction:<id>`.

When importing Granola meetings:

- Always fetch and store the raw transcript as `interactions.body_text` through
  `--text-file`; it is the durable evidence the brain should cite.
- Store Granola's AI note or agent-written digest in `--summary`, not in place of the
  transcript.
- Re-import an existing meeting with the same `--source granola --external-id` and
  `--replace-body` when the transcript becomes available or changes, so search chunks
  are regenerated from the raw transcript.
- Treat `postAnalysisRequired: true` in `brain add interaction --json` output as a
  hard follow-up, not a suggestion.
- Before the import is considered complete, run post-analysis: link participants and
  high-signal mentioned people, link or create the project context, write explicit
  follow-up tasks linked back to `interaction:<id>` with chunk evidence, and store
  only transcript-backed memories with chunk evidence.

When adding an asset:

- Import from a local file path; do not inline base64 in document text.
- Link it to a typed record with a role such as avatar, logo, attachment, inline_image,
  screenshot, or source_file.
- Preserve original filename, original path, URL, MIME type, size, and content hash when
  available.
- Pass importer-provided plain text with `--text` or `--text-file` and
  `--text-source importer` when available. Use `brain asset text set` to add text after
  the asset already exists.
- Do not pretend PDF/image bytes are searchable by content unless an importer or later
  local extractor has populated asset text. Metadata, link captions, and linked record
  titles are searchable immediately.

When adding a memory:

- Keep it atomic.
- Use one of: fact, preference, decision, commitment, instruction, risk, idea.
- Link it to visible records.
- Add chunk evidence when the claim came from a document or interaction.

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
