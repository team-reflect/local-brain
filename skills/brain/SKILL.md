---
name: brain
description: Read from and write to the user's Local Brain — a private, local-first personal CRM and knowledge base stored in SQLite. Use this whenever the user asks you to remember a person/meeting/note/task, look something up about their network or work, produce a daily brief or todo list, or surface who they should reconnect with. All access is through the `brain` CLI.
---

# Local Brain agent skill

Local Brain is the user's durable, local memory: people, organizations, projects,
tasks, the documents and interactions that connect them, and hidden atomic
memories derived from those records. It lives in one local SQLite file. You
operate it through the `brain` CLI — never by touching the database file directly.

**Golden rules**

1. **Query before you write.** Search first so you merge into existing records and
   don't create duplicates.
2. **Discover the contract.** Run `brain --json contract` when you need command
   shapes, link syntax, exit codes, or import mappings.
3. **stdout is data, stderr is diagnostics.** Always pass `--json` for machine
   output; parse success data from stdout and JSON errors from stderr.
4. **Pick the right noun** (below). Documents ≠ interactions ≠ tasks ≠ memories.
5. **Cite, don't invent.** Answers and memories are grounded in real records.
6. **Store signal, not noise.** Don't dump raw chat logs or secrets.

## The nouns

- **document** — reference material you read: a note, spec, article, transcript
  you were given. Reusable knowledge. `brain add document`.
- **interaction** — a human exchange that happened: a meeting, call, email,
  message, event. Has a date and participants. `brain add interaction`.
- **asset** — a binary file managed under the brain's `assets/` directory:
  avatars, logos, screenshots, images, and original attachments. `brain add asset`.
- **task** — something to do, optionally linked to a person/project.
  `brain add task`.
- **memory** — a hidden atomic claim about a record ("prefers async standups",
  "decided to ship in Q3"). `brain remember`. Memories cite their evidence.
- **person / organization / project** — durable entities. Create people directly
  when importing contacts or when the user gives you explicit contact details;
  otherwise let extraction discover them from documents/interactions. Link to
  them by id with `--link person:<id>`.
- **source / external identity** — provider-neutral import metadata. `brain`
  knows source slugs and external ids, not provider APIs. Upstream tools translate
  Gmail, Google People, calendars, files, or other systems into generic CLI calls.

When unsure between document and interaction: did it *happen between people at a
time*? → interaction. Is it *material to read/reference*? → document.

## Querying (read first)

```bash
brain contract --json                              # machine-readable CLI contract
brain search "northwind partnership" --json        # ranked search across records/assets
brain show person <id> --json                       # a record + its links
brain show asset <id> --json                        # asset metadata, text status, linked records
brain today --json                                   # daily brief: tasks, recents, reconnects
brain report daily --json
brain tasks plan-day --json                          # prioritized todo list
brain relationships followups --json                 # who is due for a reconnect
brain changes --since 2026-06-01T00:00:00Z --json    # what changed since a time
brain graph --center self --json                     # the user-centered graph
```

For question answering, use `brain search`, `brain show`, and cited memories or
task evidence. Reason from the returned records yourself; the CLI does not call
an LLM or synthesize answers.

In `--json` mode, command failures write parseable JSON to stderr:

```json
{ "ok": false, "error": { "kind": "runtime", "message": "...", "exitCode": 1 } }
```

## Writing

```bash
# A meeting (interaction), linked to a known person:
brain add interaction --kind meeting --title "Northwind kickoff" \
  --text-file ./notes.md --link person:<id> --json

# A person from a contact export or explicit user instruction:
brain add person --full-name "Maya Chen" --email maya@example.com \
  --phone "+1 555 0100" --json

# Idempotent source-backed contact import:
brain source ensure --slug gmail --name "Gmail" --json
brain add person --full-name "Maya Chen" --email maya@example.com \
  --source google_people --external-id people/c123 --json

# Safe untrusted email sender import. Machine/no-reply senders return id:null.
brain add person-from-email --full-name "Maya Chen" --email maya@example.com \
  --source gmail --external-id msg-123 --json

# Email interaction import with unresolved raw participants preserved:
brain add interaction --kind email --title "Intro" --text-file body.txt \
  --source gmail --external-id msg-123 \
  --participant "from:Maya Chen <maya@example.com>" --json

# Calendar event import. Put structure in typed fields, not just notes/body text:
brain add interaction --kind event --title "Calendar: Stay at Louma" \
  --occurred-at 2026-07-09 --ended-at 2026-07-12 \
  --location "Louma Country Shepherd's Hut" \
  --source google_calendar --external-id event-123 \
  --original-url "https://www.google.com/calendar/event?eid=..." \
  --participant "organizer:Alice Wyatt <alice@example.com>" \
  --self-participant "attendee:You <alex@example.com>" --json

# A binary attachment linked to an interaction:
brain add asset --file ./invoice.pdf --kind attachment \
  --mime-type application/pdf --link interaction:<id> --json

# An attachment with importer-provided searchable text:
brain add asset --file ./invoice.pdf --kind attachment \
  --mime-type application/pdf --link interaction:<id> \
  --text-file extracted.txt --text-source importer --json

# Add or replace searchable text for an existing asset:
brain asset text set <asset-id> --text-file - --source importer --json

# A reference note (document):
brain add document --title "Pricing model v2" --text "..." --json

# A task linked to a person and project:
brain add task --title "Send the proposal" --due-at 2026-07-01 \
  --link person:<id> --link project:<id> --json

# A durable fact about someone (a memory, with provenance):
brain remember --kind decision --claim "Agreed to a Q3 pilot" --link person:<id> --json
```

Notes:
- Use `--text-file <path>` (or `--text-file -` for stdin) for long content; `--text`
  for short strings. Structured calendar events can omit body text when title and
  typed fields carry the record.
- Identical document/interaction content dedupes automatically (`isDuplicate:true`);
  source-backed interactions dedupe by `--source` + `--external-id` first; people
  dedupe by external identity, any known email handle, then normalized full name;
  assets dedupe by content hash and can still be linked to a new record. Pass
  `--allow-duplicate` only when you truly mean to re-import.
- Asset search covers filenames, MIME/kind/storage metadata, original URLs, link
  captions, linked record titles, and optional `asset_texts`. Text-like UTF-8 files
  are indexed automatically; PDFs/images need importer-provided text for content
  search until a later OCR/local extractor pass.
- Resolve link ids by `brain search` first.

## Provider-neutral import workflow

External fetchers such as `gws` read upstream systems, then call `brain`:

1. Read `brain --json contract` if the command shape is unclear.
2. Ensure a stable source slug with `brain source ensure`.
3. Import likely-human contacts with `brain add person` when the source is trusted,
   or `brain add person-from-email` for untrusted sender/display-name pairs.
4. Import readable email bodies as `brain add interaction --kind email`.
5. Import calendar items as `brain add interaction --kind meeting|event`. Use `event`
   for travel, lodging, reservations, reminders, and all-day schedule blocks even
   when they have attendees; use `meeting` for people-centered appointments. Map
   start to `--occurred-at`, end to `--ended-at`, venue/address to `--location`,
   provider URL to `--original-url`, attendees to `--participant`, self attendees
   to `--self-participant`, and known people to `--link person:<id>` or matching
   participant email. Notes/body text are only for readable source leftovers that
   do not have typed fields.
6. Import original attachments with `brain add asset --link interaction:<id>`, passing
   extracted plain text with `--text-file`/`--text-source importer` when available.
7. Preserve raw participant handles with `--participant` instead of creating people
   for every address seen in an email or calendar event.

## Running a daily automation

1. `brain changes --since <yesterday> --json` — see what moved.
2. `brain today --json` — overdue/today tasks, recent interactions, reconnects.
3. For each new transcript/note the user gives you: `brain add interaction …`.
4. `brain relationships followups --json` — surface stale relationships.
5. Produce a brief from `brain report daily` + `brain tasks plan-day`.

## What not to store

- Secrets, API keys, passwords, 2FA codes.
- Raw, unsummarized logs or whole email threads — capture the signal as a memory
  or a short interaction summary instead.
- Speculation as fact. If you're unsure, lower the memory `--kind` (e.g. `idea`)
  or don't write it.

## Database resolution

The CLI normally targets a brain folder via `--brain <dir>` or `$BRAIN_ROOT`, and
uses `<dir>/brain.sqlite` with assets under `<dir>/assets`. `--db <path>` and
`$BRAIN_DB` remain advanced exact-file overrides for tests and diagnostics. It
opens SQLite directly and works with the desktop app closed. Run
`brain doctor --json` to check database and schema health. Prefer
`brain --json contract` for the current exit-code and JSON-error contract.
