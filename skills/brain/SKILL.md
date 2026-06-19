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
6. **Store evidence, not noise.** Raw Granola transcripts are durable meeting
   evidence; low-signal logs, quoted email chains, generic chat logs, and secrets
   are not.

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
  when importing contacts or when the user gives you explicit contact details.
  Create projects when there is repeated or high-signal evidence of an ongoing
  context; link first, create second, and keep projects flat. Link to them by id
  with `--link person:<id>` / `--link project:<id>`.
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
  --source gmail --external-kind message --external-id msg-123 \
  --participant "from:Maya Chen <maya@example.com>" --json

# Thread-level email import with a redacted digest:
brain add interaction --kind email --title "Everlywell Integration" \
  --summary "Production credential setup and go-live readiness." \
  --text-file digest.md --source gmail --external-kind thread \
  --external-id thread-123 --json

# Granola meeting import: raw transcript is the body, summary stays separate:
brain add interaction --kind meeting --title "Granola: Northwind kickoff" \
  --summary "Kickoff decisions and follow-ups." \
  --text-file transcript.txt --source granola --external-id meeting-123 --json

# Project/context import target:
brain add project --name "Everlywell Integration" --summary "PWN Labs Module go-live context." \
  --source agent --external-kind cluster --external-id everlywell-integration --json

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

# A transcript follow-up task linked back to the source interaction:
brain add task --title "Send cardiologist shortlist to Dr. Vargas" \
  --link interaction:<id> --link project:<id> --link person:<id> \
  --evidence interaction:<id>#0 --json

# A durable fact about someone (a memory, with provenance):
brain remember --kind decision --claim "Agreed to a Q3 pilot" \
  --link person:<id> --link interaction:<id> --evidence interaction:<id>#0 --json
```

Notes:
- Use `--text-file <path>` (or `--text-file -` for stdin) for long content; `--text`
  for short strings. Structured calendar events can omit body text when title and
  typed fields carry the record.
- Identical document/interaction content dedupes automatically (`isDuplicate:true`);
  source-backed interactions dedupe by `--source` + `--external-kind` +
  `--external-id` first; people dedupe by external identity, any known email handle,
  then normalized full name; projects dedupe by external identity, then normalized name;
  assets dedupe by content hash and can still be linked to a new record. Pass
  `--allow-duplicate` only when you truly mean to re-import.
- For source-backed interaction refreshes, pass `--replace-body` only when the upstream
  source is authoritative and the existing body should be replaced and re-chunked.
- Asset search covers filenames, MIME/kind/storage metadata, original URLs, link
  captions, linked record titles, and optional `asset_texts`. Text-like UTF-8 files
  are indexed automatically; PDFs/images need importer-provided text for content
  search until a later OCR/local extractor pass.
- Resolve link ids by `brain search` first.
- Use `--evidence document:<id>#<chunk_index>` or
  `--evidence interaction:<id>#<chunk_index>` when a task or memory comes from a
  specific source chunk.

## Provider-neutral import workflow

External fetchers such as `gws` read upstream systems, then call `brain`:

1. Read `brain --json contract` if the command shape is unclear.
2. Ensure a stable source slug with `brain source ensure`.
3. Import likely-human contacts with `brain add person` when the source is trusted,
   or `brain add person-from-email` for untrusted sender/display-name pairs.
4. Import meaningful email conversations as `brain add interaction --kind email`.
   Prefer thread-level digests with `--external-kind thread` for long Gmail threads.
   Use `--external-kind message` for standalone messages.
5. Redact or summarize when raw source text contains secrets, passwords, credential
   setup, legal/medical boilerplate, repeated quote chains, or low-signal notification
   noise. Store a concise digest in `--summary` and pass searchable digest/body text
   through `--text-file` or `--text`.
6. Search existing projects and link imports to them. Auto-create a project only when
   the source shows an ongoing outcome, not just a repeated keyword.
7. Import calendar items as `brain add interaction --kind meeting|event`. Use `event`
   for travel, lodging, reservations, reminders, and all-day schedule blocks even
   when they have attendees; use `meeting` for people-centered appointments. Map
   start to `--occurred-at`, end to `--ended-at`, venue/address to `--location`,
   provider URL to `--original-url`, attendees to `--participant`, self attendees
   to `--self-participant`, and known people to `--link person:<id>` or matching
   participant email. Notes/body text are only for readable source leftovers that
   do not have typed fields.
8. Import original attachments with `brain add asset --link interaction:<id>`, passing
   extracted plain text with `--text-file`/`--text-source importer` when available.
9. Preserve raw participant handles with `--participant` instead of creating people
   for every address seen in an email or calendar event.

## Transcript post-analysis

Every imported transcript must get an immediate enrichment pass:

1. Generate or preserve a concise `summary` separate from the raw transcript body.
2. Link participants and high-signal mentioned people. Prefer existing people by email
   or exact name; create a new person only when the transcript/title gives a clear
   durable identity.
3. Link the interaction to existing projects, or create a project only for an ongoing
   context with repeated/high-signal evidence.
4. Extract explicit follow-up tasks and link each task to the source
   `interaction:<id>`, relevant `project:<id>`, and owner/contact `person:<id>` when
   known. Add `--evidence interaction:<id>#<chunk>` when the task is grounded in a
   specific transcript chunk.
5. Store atomic memories only for stable facts, decisions, preferences, commitments,
   or risks that are directly supported by the transcript. Link the memory to the
   visible records it is about, and cite the transcript chunk with `--evidence`.

## Import source rules

- **Gmail:** search narrowly, skip obvious machine/noise messages, group recurring
  conversations by thread, and use `--external-kind thread` for thread digests.
- **Granola:** always fetch and store the raw transcript as the interaction body when
  it is available. Store Granola's AI note/summary in `--summary`, never as a
  replacement for the transcript. On re-import, use `--replace-body` with the same
  `--source granola --external-id <meeting-id>` so chunks match the current transcript.
  Then run transcript post-analysis before considering the import done.
- **Contacts:** use trusted contact imports (`brain add person`) with source-backed
  stable ids. Page/stream contacts; do not export a giant one-shot blob. Import names,
  emails, phones, org/title, and stable ids for launch; skip notes, addresses, and
  photos unless explicitly requested.

## Running a daily automation

1. `brain changes --since <yesterday> --json` — see what moved.
2. `brain today --json` — overdue/today tasks, recent interactions, reconnects.
3. For each new transcript/note the user gives you: `brain add interaction …`, then
   run transcript post-analysis.
4. `brain relationships followups --json` — surface stale relationships.
5. Produce a brief from `brain report daily` + `brain tasks plan-day`.

## What not to store

- Secrets, API keys, passwords, 2FA codes.
- Raw, unsummarized low-signal logs or whole email quote chains — capture the signal as
  a memory, `--summary`, or a short interaction digest instead.
- Speculation as fact. If you're unsure, lower the memory `--kind` (e.g. `idea`)
  or don't write it.

## Database resolution

The CLI normally targets a brain folder via `--brain <dir>` or `$BRAIN_ROOT`, and
uses `<dir>/brain.sqlite` with assets under `<dir>/assets`. `--db <path>` and
`$BRAIN_DB` remain advanced exact-file overrides for tests and diagnostics. It
opens SQLite directly and works with the desktop app closed. Run
`brain doctor --json` to check database and schema health. Prefer
`brain --json contract` for the current exit-code and JSON-error contract.
