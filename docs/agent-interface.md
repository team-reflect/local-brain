# Agent Interface

Local Brain is primarily operated by local agents through the `brain` CLI and
local agent skill. The desktop UI is for browsing, correction, inspection, Chat,
and demonstration; agents should not scrape it.

The CLI is provider-neutral. Gmail, Granola, Reflect notes, Calendar, contacts,
and other upstream systems are fetched by external tools or agent code, then
translated into generic Local Brain commands.

## Principles

- Query before writing.
- Use typed records: people, organizations, projects, tasks, documents,
  interactions, transcripts, AI notes, extracted facts, memories, assets, and
  tags.
- Preserve source identity with `--source`, `--external-kind`, `--external-id`,
  and `--original-url` where available.
- For people and organizations, use `--external-id` only when it identifies the
  person/org itself. Source record ids such as email threads, messages, meetings,
  events, and notes belong on documents/interactions, not entities.
- Keep stdout as data and stderr as diagnostics. Use global `--json` for stable
  machine output and JSON errors.
- Store complete local readable evidence before summaries. Never redact an
  imported source body; if a source record is too sensitive or not worth storing,
  skip the whole record and ledger the reason.
- Store AI narratives as `ai_notes`, not as replacements for source text.
- Treat extracted claims as facts first; promote only durable, useful claims to
  memories.
- Cite exact evidence chunks when creating tasks, facts, AI notes, and memories.
- Create projects only after explicit user agreement; otherwise link existing
  projects or suggest inferred project candidates.
- Treat `brain --json contract` as the discoverable source of truth for command
  shapes, exit codes, source slugs, and link syntax.

## Read Commands

```bash
brain --json contract
brain --json doctor
brain path
brain --json import-context --limit 200
brain --json search "revised budget"
brain --json show person <id>
brain --json today
brain --json report daily
brain --json tasks plan-day --limit 25
brain --json graph --center self
brain --json suggest list
brain --json import audit --limit 100
```

Use `brain import-context` at the start of an import. It returns self identity,
registered sources, existing projects and organizations, open suggestions, import
watermarks, and counts.

`brain today` and `brain report daily` return task buckets plus richer operating
context: waiting items, recent write-time changes, relationship hints, and recent
interactions with source, participant, summary, and readable excerpt fields when
imported source text is available.

## Write Phases

Source-led imports should move through explicit phases:

```bash
brain --json import interaction ...
brain --json import document ...
brain --json import transcript --interaction <id> --text-file transcript.txt ...
brain --json enrich person <id> ...
brain --json enrich organization <id> ...
brain --json add ai-note ...
brain --json add fact ...
brain --json promote fact <fact-id> --memory-kind <kind>
brain --json tag ensure --name "Picardo"
brain --json tag attach --tag picardo --record interaction:<id>
brain --json import participants audit --min-count 2
brain --json import finalize --record interaction:<id>
```

The older `brain add document` and `brain add interaction` commands remain valid
aliases for direct typed writes. Prefer `brain import ...` in import harnesses so
the staged workflow is obvious in logs.

Use `brain add project` only after the user has agreed to the project boundary:

```bash
brain --json add project --name "House" \
  --summary "Renovation and property work for 701 W Elizabeth St and 700 Jewell St"
```

## Identity And Provenance

Source-backed imports should pass `--source`, `--external-kind`, and
`--external-id` whenever the upstream system has a durable identifier. That
triple is stored in `external_identities` and is the dedupe key for re-imports.
For person and organization writes, that identifier must be the upstream
identity of the person/org itself, such as a contact id, normalized domain, or
stable organization id. Do not reuse the source record id that merely mentioned
the person/org.

When a person/org external identity matches an active record but the incoming
email, domain, or normalized name conflicts, the CLI returns JSON error kind
`external_identity_conflict` with `existingRecordId` and `conflictingFields`.
Treat that as an import bug or repair task, not as a reason to force enrichment.

`record_provenance` is a separate trail of how a Local Brain record was created
or enriched: imported source records, generated AI notes, extracted facts,
promoted memories, profile enrichment, and successful finalization all write
provenance events. Do not use provider-specific IDs as Local Brain IDs; keep
them in source identity/provenance fields and link the typed record normally.

## Common Examples

Ensure sources:

```bash
brain --json source ensure --slug gmail --name Gmail
brain --json source ensure --slug granola --name Granola
brain --json source ensure --slug reflect_notes --name "Reflect Notes"
```

Set the self person once:

```bash
brain --json self show
brain --json self set --full-name "Alex MacCaw" \
  --email alex@maccaw.org --email alex@picardo.health
```

Import a Gmail thread with full readable source text:

```bash
brain --json import interaction --kind email \
  --title "Gmail: Everlywell Integration" \
  --summary "Production credential setup and go-live readiness." \
  --text-file full-thread.md \
  --source gmail --external-kind thread --external-id <thread-id> \
  --participant "from:Maya Chen <maya@example.com>" \
  --link project:<id>
```

Import a structured calendar event:

```bash
brain --json import interaction --kind event \
  --title "Calendar: Flight: London Heathrow, LHR to AUS" \
  --summary "Flight and related booking details." \
  --text-file full-calendar-event.txt \
  --metadata-json-file raw-google-calendar-event.json \
  --event-json-file event-details.json \
  --occurred-at 2026-07-09T09:00:00 \
  --ended-at 2026-07-09T15:20:00 \
  --source google_calendar --external-kind event --external-id <event-id> \
  --original-url "https://www.google.com/calendar/event?eid=..."
```

Import a Granola meeting with raw transcript and AI note:

```bash
brain --json import interaction --kind meeting \
  --title "Granola: Northwind kickoff" \
  --summary "Kickoff decisions and follow-ups." \
  --source granola --external-id <meeting-id> \
  --participant "attendee:Robin Spencer <robin@example.com>" \
  --link project:<id>

brain --json import transcript --interaction <interaction-id> \
  --text-file transcript.txt \
  --source granola --external-kind transcript --external-id <meeting-id>

brain --json add ai-note --kind summary \
  --interaction <interaction-id> \
  --title "Meeting summary" \
  --text-file summary.md \
  --source granola
```

Import a Reflect note as a source-backed document:

```bash
brain --json import document \
  --title "Reflect: Project Alpha" \
  --text-file note.md \
  --source reflect_notes --external-kind note --external-id <note-id> \
  --original-path "$HOME/Documents/reflect-maccman2/Project Alpha.md" \
  --link project:<id> --link person:<id>
```

Add a fact, promote a selected fact, and tag the record:

```bash
brain --json add fact --subject interaction:<id> \
  --key "decision" \
  --value-text "The team agreed to ship the credential flow before launch." \
  --source-record interaction:<id> \
  --source gmail --external-kind extracted-fact --external-id thread-123:decision:credential-flow \
  --evidence interaction:<id>~"ship the credential flow"

# Transcript evidence works the same way through universal chunks.
brain --json add fact --subject interaction:<id> \
  --key "follow_up" \
  --value-text "Credential flow needs to be ready before Friday." \
  --source-record interaction_transcript:<transcript-id> \
  --evidence interaction_transcript:<transcript-id>~"credential flow"

brain --json promote fact <fact-id> --memory-kind decision
brain --json tag ensure --name "Picardo"
brain --json tag attach --tag picardo --record interaction:<id>
brain --json import finalize --record interaction:<id>
```

Audit and normalize participants after source passes:

```bash
brain --json import participants audit --source gmail --min-count 2 --limit 100
brain --json import participants promote --handle maya@example.com \
  --full-name "Maya Chen" --headline "Picardo vendor contact" \
  --org "Example Labs" --org-domain example.com --title "Operations lead" --current
brain --json repair participants relink --handle maya@example.com --person <person-id>
brain --json repair person-email move --email maya@example.com \
  --from <wrong-person-id> --to <right-person-id> --relink-participants
brain --json repair person-phone move --phone "+1 555 0100" \
  --from <wrong-person-id> --to <right-person-id> --relink-participants
brain --json import participants audit --min-count 2 --fail-on-promote-candidates
```

Use `repair participants relink --from-person <wrong-person-id>` for rows already
linked to the wrong person. Add `--force` only when the target is already linked in
the same interaction and the duplicate participant row should be merged away.

Promoting a fact stores the fact value as the memory claim. The fact key,
subject, source record, and evidence remain available through the extracted fact,
memory links, and citations.

Enrich a person and organization:

```bash
brain --json enrich person <person-id> \
  --headline "Picardo vendor contact for lab logistics" \
  --current-title "Operations lead" \
  --role-family operations --seniority lead

brain --json enrich organization <org-id> \
  --headline "Clinical lab partner" \
  --website "https://example.com" \
  --industry healthcare \
  --one-line-description "Clinical testing provider for launch workflows." \
  --why-it-matters "Relevant to credentialing and ordering paths." \
  --source-urls-json '["https://example.com"]' \
  --model "agent-research" --prompt-fingerprint "org-profile-v1"
```

Clean up a mistaken import or duplicate shell:

```bash
brain --json merge person --from <duplicate-person-id> --to <canonical-person-id> --dry-run
brain --json merge person --from <duplicate-person-id> --to <canonical-person-id> \
  --reason "duplicate contact shell"

brain --json unlink person:<person-id> organization:<org-id> \
  --reason "org field contained a city, not an employer"
brain --json archive organization <org-id> --reason "mistaken organization import"

brain --json person rename <person-id> --full-name "Juvy Lastname"
brain --json person email add <person-id> --email juvy@example.com
brain --json person phone add <person-id> --phone "+1 555 0100"
```

`merge person` moves contact handles, affiliations, participant rows, typed links,
tags, source identities, and fact/memory references onto the target, then archives
the source. Source provenance stays attached to the archived source, and the
target gets an explicit merge provenance event. It refuses to merge away the self
person; merge duplicate shells into self instead. Always dry-run large cleanup
merges first.

Facts remain append-only by default. For low-level import facts that should be
stable across reruns, include a source identity and pass `--refresh` only when the
source-keyed fact should be replaced:

```bash
brain --json add fact --subject person:<person-id> --key membership \
  --value-text "Jane is part of Friend CRM." \
  --source friend_crm --external-kind membership \
  --external-id friend-crm:<person-id>:membership --refresh
```

Create a task with evidence:

```bash
brain --json add task --title "Send Maya the revised budget" \
  --link project:<id> --link person:<id> --link interaction:<id> \
  --assignee <person-id> \
  --evidence interaction:<id>#0
```

Evidence refs point at universal `content_chunks`, not just documents and
interactions. Use `record_type:id#0` or `record_type:id~"quote"` for
`document`, `interaction`, `interaction_transcript`, `ai_note`,
`extracted_fact`, profiles, tasks, projects, memories, and assets.

## Completion Rule

A meeting, email, or document import is incomplete until it has:

- source identity;
- participants or entities where applicable;
- complete readable source text or transcript, unless `--raw-text-unavailable`
  records a real source limitation;
- an AI note;
- extracted facts;
- links to existing projects or tasks when relevant;
- evidence-backed tasks or promoted memories when actions/claims were derived;
- tags;
- retrieval chunks.

Run:

```bash
brain --json import finalize --record interaction:<id>
brain --json import audit --limit 100
brain --json import participants audit --min-count 2 --fail-on-promote-candidates
```

`finalize` returns `complete:false` with a `missing` array until the staged
requirements are satisfied. When a good import intentionally lacks something,
use an explicit waiver such as `--raw-text-unavailable`, `--no-entities`,
`--no-project-or-task-link`, `--no-derived-actions`, or
`--no-extracted-facts`; a successful finalize writes durable `finalized`
provenance so audit does not re-raise the record.

`import finalize` is record-level completeness. It does not prove global
participant normalization is done; run the participant audit fail gate before a
backfill final report.

Concise summaries are welcome in `summary` or `ai_note` records, but they must
not replace source body text. Calendar placeholders such as "see Gmail for
details" should stay incomplete unless the importer fetches the linked Gmail
source or explicitly records that raw text is unavailable.

## Guardrails

Person-from-email and organization-from-email paths are cautious. Use
`brain add person-from-email` for untrusted display names; it returns structured
skip reasons for machine senders, no-reply addresses, invalid emails, token-like
names, and email-as-name values.

For `person-from-email`, omit `--external-id` unless the id is a stable upstream
contact/person id. A Gmail message or thread id is the external identity for the
imported email interaction, not the sender.

Do not create projects that the user has not signed off on, and do not infer
high-impact organizations from a single weak clue. Use `brain suggest project`
or `brain suggest organization` with evidence and let the user accept or
dismiss.

Do not store provider-specific logic in the CLI. Agents own upstream pagination,
filtering, credential handling, transcript retrieval, attachment extraction, and
translation into generic `brain` calls.
