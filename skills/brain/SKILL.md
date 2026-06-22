---
name: brain
description: Read from and write to the user's Local Brain, a private local-first personal CRM and intelligence database stored in SQLite. Use for remembering or finding people, organizations, projects, tasks, documents, interactions, transcripts, facts, memories, and daily brief context. All writes go through the `brain` CLI.
---

# Local Brain

Local Brain is the user's durable local memory. It stores typed records,
evidence, AI notes, extracted facts, curated memories, tags, assets, and universal
search chunks in SQLite. Use the `brain` CLI; do not write SQLite directly.

## Golden Rules

1. **Query before you write.** Run `brain --json import-context` and targeted
   `brain --json search` calls before creating or linking records.
2. **Discover the contract.** Run `brain --json contract` when command shapes,
   link syntax, exit codes, or source rules are unclear.
3. **Verify the target brain.** Pass the intended `--brain <dir>` or verify
   `$BRAIN_ROOT` with `brain --json doctor` and `brain path` before writes.
4. **stdout is data, stderr is diagnostics.** Use global `--json`; parse success
   data from stdout and JSON errors from stderr.
5. **Import source-led.** Enumerate source records first. Keyword search is a
   filter, not a coverage plan.
6. **Store evidence before intelligence.** Raw text/transcripts come first; AI
   notes, facts, tasks, tags, and memories complete the import.
7. **Cite, do not invent.** Use chunk evidence for derived tasks, facts, AI notes,
   and memories.
8. **Create agreed projects, suggest uncertain structure.** Add a project only
   after the user has signed off on that project boundary. Link existing
   projects/orgs; use suggestions for unapproved project candidates or
   high-impact inferred organizations.
9. **Use entity external IDs only for entities.** For people/orgs, `--external-id`
   must identify that person/org itself, not an email thread, message, meeting,
   event, document, or other source record.
10. **Finish participant normalization.** Backfills are not complete until
    unresolved participant handles are audited and recurring real people are
    promoted or ledgered.

## Brain selection

When this skill is installed by Local Brain, the app writes a generated
`brains.json` file next to this `SKILL.md`. Read it before running `brain`:

- Use the entry with `isActive: true` by default.
- Pass `--brain <rootPath>` on CLI calls, or set `BRAIN_ROOT=<rootPath>` for a
  sequence of calls.
- If there is no active brain or the user names a different brain, choose the
  matching `name` / `rootPath` from `brains.json`.
- If `brains.json` is missing or ambiguous, ask the user which brain folder to
  use instead of guessing.

## Nouns

- **person** - someone the user knows. Use `brain add person`, `brain add
  person-from-email`, or `brain enrich person`.
- **organization** - company, team, vendor, school, club, or institution. It has
  a `headline`; use `brain add organization` or `brain enrich organization`.
- **project** - user-agreed workstream or life area. Use `brain add project`
  only after explicit user sign-off; otherwise link existing projects or
  propose candidates with `brain suggest project`.
- **task** - commitment, waiting item, reminder, or follow-up. Cite source chunks
  when derived from an import.
- **interaction** - meeting, call, email, message, event, or note that happened
  at a time.
- **interaction_transcript** - raw transcript text for an interaction.
- **document** - durable reference material such as a note, file, webpage, plan,
  memo, receipt, or imported text artifact.
- **ai_note** - narrative AI artifact: summary, action items, decisions, risks,
  highlights, coaching, or other.
- **extracted_fact** - append-only structured claim. Promote selected facts to
  hidden memories with `brain promote fact`.
- **memory** - curated hidden atomic claim with evidence and links.
- **asset** - managed binary file plus optional searchable text.

## Read First

```bash
brain --json doctor
brain path
brain --json contract
brain --json import-context --limit 200
brain --json search "northwind kickoff"
brain --json show person <id>
brain --json show interaction <id>
brain --json show ai_note <id>
brain --json suggest list
brain --json import audit --limit 100
brain --json today
brain --json report daily
brain --json tasks plan-day --limit 25
brain --json graph --center self
```

For answer generation, use `brain search`, `brain show`, tasks, memories, and
evidence. The CLI does not synthesize answers for you.

Every JSON search hit includes `recordRef` and `showCommand`. Use
`brain --json show <kind> <id>` for the returned kind instead of reading SQLite
directly; the CLI supports `show` for all kinds it returns from search,
including interactions, transcripts, AI notes, facts, memories, organization
profiles, and assets.

For a daily brief, use `brain --json report daily` as the complete context
payload. It includes the self display name, task buckets, waiting items, recent
interactions with excerpts and participants, recent changes, relationship
context, active projects, counts, and generated date metadata. Generate the
narrative outside Local Brain from that JSON; do not scrape the Tauri Today
surface.

## Staged Import

Preferred import flow:

```bash
brain --json import interaction ...
brain --json import document --source <slug> --external-kind <kind> --external-id <id> ...
brain --json import transcript --interaction <id> --text-file transcript.txt ...
brain --json add ai-note --interaction <id> --text-file summary.md
brain --json add fact --subject interaction:<id> --key decision --value-text "..." \
  --source-record interaction:<id> --evidence interaction:<id>~"short quote"
brain --json promote fact <fact-id> --memory-kind decision
brain --json tag ensure --name "Picardo"
brain --json tag attach --tag picardo --record interaction:<id>
brain --json import participants audit --min-count 2
brain --json import participants promote --handle maya@example.com --full-name "Maya Chen"
brain --json import finalize --record interaction:<id>
```

Older direct writes still work:

```bash
brain --json add document --title "Pricing model v2" --text-file note.md
brain --json add interaction --kind email --title "Intro" --text-file body.txt
```

Use `brain --json import finalize --record kind:id` after an import. Complete
imports have source identity, entities/participants, complete readable source
text when the source has text, AI note, extracted facts, project/task links when
relevant, evidence-backed tasks or memories, tags, and chunks. Do not redact
imported source bodies; skip and ledger the whole source record if it should not
be stored locally. If a good import intentionally lacks a stage, finalize with
the narrow waiver that explains it: `--raw-text-unavailable`,
`--no-entities`, `--no-project-or-task-link`, `--no-derived-actions`, or
`--no-extracted-facts`.

Record-level finalize does not replace global normalization. Before a backfill
final report, run `brain --json import participants audit --fail-on-promote-candidates`
after promoting recurring real people or ledgering unresolved cases.

For backfills, keep each bounded source pass auditable outside the brain DB.
Use local pass artifacts such as `manifest.jsonl`, `review-queue.jsonl`,
`decisions.jsonl`, `decisions.tsv`, `import-ledger.tsv`, raw provider JSON,
readable text files, and `report.md`. Record provider estimates, explicit caps,
fetched/imported/skipped/duplicate counts, and the unreviewed remainder. Dedupe
new source records against all prior pass ledgers and source identities before
writing.

## People And Organizations

Create person/org records when evidence shows repeated meaningful contact, a
known relationship, or durable future relevance. Do not create a person for
every imported handle or a company for every domain. Preserve weak or one-off
entities as participants, suggestions, or tags until more evidence appears.

Before large imports, register the user's known handles with `brain self set` so
self participants normalize automatically. Use `--self-participant` for a
source-specific user handle that is not registered yet.

Pass phone participants as handles, not just metadata:
`--participant "from:Andy <+1 415 688 0341>"`. The CLI normalizes phone handles
so both `brain --json search "+14156880341"` and
`brain --json search "4156880341"` can find the interaction. Provider metadata
belongs in `metadata_json`, but participant phone numbers should also be written
through `--participant` when they identify a sender, recipient, attendee, or
chat participant.

Keep headlines and affiliations conservative. Prefer "works on", "contact for",
or "appears affiliated with" over exact titles unless the source states the
title. Mark affiliations current only when current evidence supports it.

Skip machine/shared mailboxes and low-signal domains as entities:

- no-reply, notifications, support, billing, receipts, calendar, mailer-daemon
- personal or email-provider domains such as gmail.com, icloud.com, outlook.com

Creating people/orgs improves future participant normalization. Existing
imported participant rows can be audited and normalized with:

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
```

Use read-only SQL only for audits and candidate discovery; all creates,
enrichments, affiliations, promotions, and repairs go through `brain`.

If `brain --json add person`, `brain --json add person-from-email`, or
`brain --json add organization` returns `external_identity_conflict`, stop and
fix the import identity. Do not retry by forcing enrichment onto the matched
record.

Trusted contact:

```bash
brain --json add person --full-name "Maya Chen" \
  --email maya@example.com --phone "+1 555 0100" \
  --headline "Picardo vendor contact for lab logistics" \
  --org "Example Labs" --org-domain example.com --title "Operations lead" --current
```

Untrusted email sender:

```bash
brain --json add person-from-email --full-name "Maya Chen" \
  --email maya@example.com --source gmail
```

Only pass `--external-id` here when the upstream id is a stable contact/person
id for Maya herself. Do not use the Gmail message or thread id; that belongs on
the imported interaction.

Enrichment:

```bash
brain --json enrich person <id> --headline "House design contact" \
  --current-title "Designer" --role-family design --seniority lead

brain --json add organization --name "Example Labs" --domain example.com \
  --headline "Clinical lab partner"

brain --json enrich organization <id> \
  --one-line-description "Clinical testing provider for launch workflows." \
  --why-it-matters "Relevant to credentialing and ordering paths." \
  --source-urls-json '["https://example.com"]'
```

Use `brain suggest organization` when an org is weakly inferred from one email
signature or ambiguous domain. Use `brain affiliate --person <id> --org <id>
--title <title> --department <dept> --role-family <family> --seniority <level>
--current --primary` for existing records.

### Cleanup And Dedupe

Use CLI cleanup primitives instead of direct SQLite updates:

```bash
brain --json merge person --from <duplicate-person-id> --to <canonical-person-id> --dry-run
brain --json merge person --from <duplicate-person-id> --to <canonical-person-id> \
  --reason "duplicate contact shell"

brain --json unlink person:<person-id> organization:<org-id> \
  --reason "org field was a location, not an employer"
brain --json archive organization <org-id> --reason "mistaken organization import"

brain --json person rename <person-id> --full-name "Correct Name"
brain --json person email add <person-id> --email correct@example.com
brain --json person phone add <person-id> --phone "+1 555 0100"

brain --json repair participants relink --handle wrong@example.com \
  --person <right-person-id> --from-person <wrong-person-id>
```

Add `--force` only when the target is already linked in the same interaction and the
wrong-person participant row should be merged away.

Always dry-run `merge person` before applying it in a large backfill. It moves
handles, affiliations, participant rows, typed links, tags, source identities, and
fact/memory references to the target, then archives the source. Source provenance
stays attached to the archived source, and the target gets an explicit merge
provenance event. It refuses to merge away the self person; merge duplicates into
self instead.

Archive bad shells after unlinking active relationships that should not survive.
Organization archive blocks while active current affiliations remain; use
`unlink` first when the affiliation itself was wrong.

## Projects

Create projects only when the user has agreed to the project boundary:

```bash
brain --json add project --name "House" \
  --summary "Renovation and property work for 701 W Elizabeth St and 700 Jewell St" \
  --link person:<id> --link interaction:<id>
```

When a source strongly hints at a project but the user has not signed off, do
not create the project. Use `brain suggest project` with evidence instead.

## Email, Calendar, And Meetings

Gmail thread:

```bash
brain --json import interaction --kind email \
  --title "Gmail: Everlywell Integration" \
  --summary "Production credential setup and go-live readiness." \
  --text-file full-thread.md \
  --source gmail --external-kind thread --external-id <thread-id> \
  --participant "from:Maya Chen <maya@example.com>" \
  --link project:<id>
```

For historical Gmail backfills, prefer `from:me` as the first bounded pass. It
usually surfaces high-signal relationship and project threads because it captures
what the user replied to, approved, introduced, or coordinated. Follow with
`is:important`, recurring correspondent/domain, attachment-heavy, and explicit
project passes as needed. Skip commodity confirmations, self-authored daily
digests, shared mailbox noise, and sensitive personal/family/medical material
unless explicitly approved or clearly part of an accepted project.

Calendar event:

```bash
brain --json import interaction --kind event \
  --title "Calendar: Stay at Louma" \
  --occurred-at 2026-07-09 --ended-at 2026-07-12 \
  --location "Louma Country Shepherd's Hut" \
  --text-file full-calendar-event.txt \
  --metadata-json-file raw-google-calendar-event.json \
  --event-json-file event-details.json \
  --source google_calendar --external-id event-123 \
  --original-url "https://www.google.com/calendar/event?eid=..." \
  --participant "organizer:Alice Wyatt <alice@example.com>" \
  --self-participant "attendee:You <alex@example.com>" \
  --link project:<id>
```

Use `event` for travel, lodging, reservations, reminders, all-day blocks, and
non-meeting schedule context even if attendees exist. Use `meeting` for
people-centered appointments.
Calendar events that only say "see Gmail for details" are incomplete unless the
importer fetches the linked Gmail source or records `--raw-text-unavailable`.

Granola meeting:

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
```

Always preserve unresolved participants with `--participant`. Do not create a
person for every handle. Register the user with `brain self set` so their known
emails resolve automatically; use `--self-participant` for user handles not yet
registered.

## Evidence

Use chunk evidence by index or quote:

```bash
brain --json add task --title "Send Maya the revised budget" \
  --link project:<id> --link person:<id> --link interaction:<id> \
  --evidence interaction:<id>#0

brain --json add fact --subject person:<id> --key preference \
  --value-text "Prefers async updates before Friday." \
  --source-record interaction:<id> \
  --source gmail --external-kind extracted-fact --external-id thread-123:preference:async-updates \
  --evidence interaction:<id>~"async updates before Friday"

brain --json add fact --subject interaction:<id> --key follow_up \
  --value-text "Credential flow needs to be ready before Friday." \
  --source-record interaction_transcript:<transcript-id> \
  --evidence interaction_transcript:<transcript-id>~"credential flow"
```

Evidence refs resolve against universal `content_chunks`; use
`record_type:id#0` or `record_type:id~"quote"` for `document`, `interaction`,
`interaction_transcript`, `ai_note`, `extracted_fact`, profiles, tasks, projects,
memories, and assets. Quote evidence is case-insensitive and literal against
stored chunk text. Use a short distinctive phrase.

For low-level import facts that should be stable across reruns, include
`--source`, `--external-kind`, and `--external-id`. The same source-keyed fact is
returned as a duplicate on rerun; pass `--refresh` only when the importer should
replace that fact's fields, chunks, and evidence.

## Assets

```bash
brain --json add asset --file ./invoice.pdf --kind attachment \
  --mime-type application/pdf --link interaction:<id>

brain --json add asset --file ./invoice.pdf --kind attachment \
  --link interaction:<id> --text-file extracted.txt --text-source importer

brain --json asset text set <asset-id> --text-file - --source importer
```

Asset search covers filenames, metadata, URLs, link captions, linked record
titles, and optional asset text. PDFs/images are not content-searchable until an
importer or local extractor supplies text.

## Suggestions

```bash
brain --json suggest project --title "House" --summary "701 W Elizabeth St and 700 Jewell St" \
  --link interaction:<id>
brain --json suggest organization --title "Example Labs" --domain example.com \
  --link interaction:<id>
brain --json suggest list
brain --json suggest accept <id>
brain --json suggest dismiss <id>
```

Suggestions are user-facing curation, not an automation log. Every suggestion
must be actionable and evidence-backed.

## Target Brain

The CLI targets a brain folder via `--brain <dir>` or `$BRAIN_ROOT`, and uses
`<dir>/brain.sqlite` with assets under `<dir>/assets`. It does not guess a default
brain root. `--db <path>` and `$BRAIN_DB` remain advanced exact-file overrides
for tests and diagnostics. It opens SQLite directly and works with the desktop
app closed. Run
`brain doctor --json` to check database and schema health. Prefer
`brain --json contract` for the current exit-code and JSON-error contract.
