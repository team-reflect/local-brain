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
2. **stdout is data, stderr is diagnostics.** Always pass `--json` for machine
   output and parse stdout only.
3. **Pick the right noun** (below). Documents ≠ interactions ≠ tasks ≠ memories.
4. **Cite, don't invent.** Answers and memories are grounded in real records.
5. **Store signal, not noise.** Don't dump raw chat logs or secrets.

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

When unsure between document and interaction: did it *happen between people at a
time*? → interaction. Is it *material to read/reference*? → document.

## Querying (read first)

```bash
brain search "northwind partnership" --json        # full-text across all records
brain show person <id> --json                       # a record + its links
brain ask "what did we decide about pricing?" --json # grounded, cited answer
brain today --json                                   # daily brief: tasks, recents, reconnects
brain report daily --json
brain tasks plan-day --json                          # prioritized todo list
brain relationships followups --json                 # who is due for a reconnect
brain changes --since 2026-06-01T00:00:00Z --json    # what changed since a time
brain graph --center self --json                     # the user-centered graph
```

`brain ask` always returns the **cited evidence** it retrieved. If a model is
configured (`ANTHROPIC_API_KEY`), it also synthesizes a cited answer; otherwise
it returns `answered:false` with the evidence — **you** are the model, so reason
over the returned `citations` yourself. Each citation names the owning document
or interaction so the user can open the exact source.

## Writing

```bash
# A meeting (interaction), linked to a known person:
brain add interaction --kind meeting --title "Northwind kickoff" \
  --text-file ./notes.md --link person:<id> --json

# A person from a contact export or explicit user instruction:
brain add person --full-name "Maya Chen" --email maya@example.com \
  --phone "+1 555 0100" --json

# A binary attachment linked to an interaction:
brain add asset --file ./invoice.pdf --kind attachment \
  --mime-type application/pdf --link interaction:<id> --json

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
  for short strings.
- Identical document/interaction content dedupes automatically (`isDuplicate:true`);
  people dedupe by primary email, then normalized full name; assets dedupe by content
  hash and can still be linked to a new record. Pass `--allow-duplicate` only when
  you truly mean to re-import.
- Resolve link ids by `brain search` first.

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
`brain doctor --json` to check health (schema version, model configured, curl
available). Exit codes: `0` ok, `1` runtime error, `3` not found, `4` no database.
