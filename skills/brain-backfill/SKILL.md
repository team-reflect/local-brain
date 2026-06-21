---
name: brain-backfill
description: Source-led first-run or large historical Local Brain import. Use when setting up a new brain from Gmail/GWS, Granola, Reflect notes, Calendar, contacts, or other personal data sources, especially when the user asks for a comprehensive backfill.
---

# Local Brain Backfill

Use this after reading `skills/brain/SKILL.md`. This skill is for first setup or
large historical imports where coverage matters. The goal is a useful typed
personal intelligence database, not a dump of every byte.

## Non-Negotiables

1. Verify the target brain and pass it to every write:

   ```bash
   export BRAIN_ROOT="/path/to/brain-folder"
   brain --brain "$BRAIN_ROOT" --json doctor
   brain --brain "$BRAIN_ROOT" path
   brain --brain "$BRAIN_ROOT" --json contract
   ```

2. Use only the `brain` CLI for writes. Do not mutate SQLite directly.
3. Enumerate source records first. Keyword search is a filter, not a coverage
   strategy.
4. Keep a local scratch ledger outside the brain DB with every source record's
   disposition.
5. Treat staged completion as mandatory: raw record, transcript/text, AI note,
   facts, links, evidence-backed tasks/memories, tags, chunks, finalize.
6. People need conservative headlines and affiliations during the import, not as
   unspecified cleanup.
7. Organizations need compact headlines and, when evidence supports it,
   `brain enrich organization` profile rows during the import.
8. Attach imported files as assets and provide searchable extracted text when
   useful; binary PDFs/images are otherwise metadata-only.
9. Skip deliberately: secrets, passwords, one-time links, medical/financial
   boilerplate, promos, alerts, receipts, and private material usually do not
   belong in the brain.

## Setup

```bash
brain --brain "$BRAIN_ROOT" --json import-context --limit 300
brain --brain "$BRAIN_ROOT" --json self show
brain --brain "$BRAIN_ROOT" --json source ensure --slug gmail --name Gmail
brain --brain "$BRAIN_ROOT" --json source ensure --slug granola --name Granola
brain --brain "$BRAIN_ROOT" --json source ensure --slug reflect_notes --name "Reflect Notes"
brain --brain "$BRAIN_ROOT" --json source ensure --slug google_calendar --name "Google Calendar"
brain --brain "$BRAIN_ROOT" --json source ensure --slug google_people --name "Google People"
```

Before starting source passes, inspect the returned `projects` and
`counts.projects`. If no projects exist, do not continue directly into import
writes. First identify the user's core project boundaries from self context,
source metadata, and high-signal source records such as emails, calendar events,
notes, meetings, and contacts. Present a compact candidate project list with the
evidence that supports each boundary, get explicit user sign-off, then create
only the approved projects with `brain add project` before proceeding.

If self is missing or has no handles, register known user emails before importing
email/calendar data:

```bash
brain --brain "$BRAIN_ROOT" --json self set \
  --full-name "Alex MacCaw" \
  --email alex@maccaw.org --email alex@picardo.health
```

## Ledger

Use a scratch file such as `.codex-imports/backfill-ledger.tsv`:

```text
source    external_id    date    title    status    project    reason    local_record
```

Statuses:

- `imported`
- `refreshed`
- `duplicate`
- `skipped`
- `needs_review`
- `suggested`
- `incomplete`

Final reports must include considered/imported/refreshed/duplicate/skipped/
needs-review/incomplete counts by source and notable gaps.

## Parallelization

For large backfills, split by source and month. Each worker must:

- receive the same `BRAIN_ROOT`;
- read `brain --json import-context` at start;
- write through the CLI only;
- use source identity for idempotence;
- use `--refresh` for routine source-backed reimports, and `--replace-body`
  only when intentionally overwriting stale imported body text;
- maintain its own ledger shard;
- run `brain --json import finalize --record kind:id` on every imported record,
  adding only narrow explicit waivers when source data is truly absent;
- report incomplete records instead of hiding them.

Merge ledger shards at the end and run one global audit.

## Source Passes

### Projects And Boundaries

Start from accepted projects in `import-context`. Treat the project inventory as
a gate, not background context: if `counts.projects` is zero or `projects` is
empty, pause the backfill and figure out the user's core projects before creating
durable records.

To identify initial project candidates, inspect enough source context to see the
real workstreams: correspondent domains, recurring meeting titles, calendar
clusters, note paths/headings, contact affiliations, and repeated subject stems.
This discovery may require reading selected high-signal emails, meetings, notes,
or events, but it is still a discovery pass: ledger what was considered and do
not import records yet except for necessary source setup/self identity.

Present the user with a compact sign-off list: candidate name, one-sentence
boundary, supporting evidence, and any obvious non-goals or merge/split choices.
Group each company/product as one project unless the user explicitly asks for
subprojects. After the user approves boundaries, create those projects with
`brain add project` and link later imports to them. For any later source record
that hints at an unapproved project boundary, do not auto-create it during
import; use `brain suggest project` with evidence.

### Granola

Enumerate all meetings in the date window. For each high-signal meeting:

```bash
brain --brain "$BRAIN_ROOT" --json import interaction --kind meeting \
  --title "Granola: <title>" \
  --summary "<concise digest>" \
  --source granola --external-id <meeting-id> \
  --participant "attendee:Name <email>" \
  --link project:<id>

brain --brain "$BRAIN_ROOT" --json import transcript \
  --interaction <interaction-id> \
  --text-file transcript.txt \
  --source granola --external-kind transcript --external-id <meeting-id>

brain --brain "$BRAIN_ROOT" --json add ai-note \
  --kind summary --interaction <interaction-id> \
  --title "Meeting summary" --text-file summary.md --source granola \
  --evidence interaction_transcript:<transcript-id>~"<short distinctive quote>"
```

Then add facts, tasks, memories, and tags with evidence. Skip meetings that are
private, sensitive, pure scheduling, demos with no durable signal, or already
represented elsewhere; record the reason.

### Gmail / GWS

Do not rely only on project keywords. For each month:

1. Page thread/message metadata.
2. Cluster by correspondent domain, sender/recipient, subject stem, known
   projects, and attachments.
3. Read high-signal threads.
4. Import concise redacted thread digests as `interaction --kind email`.
5. Preserve participants, source identity, project links, AI note, facts, tags,
   and evidence-backed tasks/memories.

Example:

```bash
brain --brain "$BRAIN_ROOT" --json import interaction --kind email \
  --title "Gmail: <short subject>" \
  --summary "<digest>" \
  --text-file digest.md \
  --source gmail --external-kind thread --external-id <thread-id> \
  --participant "from:Name <email>" --participant "to:Alex <email>" \
  --link project:<id>
```

Skip credentials, codes, receipts, promos, alerts, long quoted chains, and
legal/medical boilerplate unless they contain durable project intelligence.
Use `--refresh` for repeat passes over the same thread so unchanged digests stay
idempotent.

### Reflect Notes

Enumerate every note in scope by path/date. For each note choose one:

- full `import document` when mostly reference material;
- redacted digest document when project signal is mixed with private material;
- `skipped` with concrete reason;
- `needs_review` when sensitive but likely important.

Use stable source identity:

```bash
brain --brain "$BRAIN_ROOT" --json import document \
  --title "Reflect: <note title>" \
  --text-file digest.md \
  --source reflect_notes --external-kind note --external-id <stable-note-id> \
  --original-path "$HOME/Documents/reflect-maccman2/<note>.md" \
  --link project:<id>
```

### Calendar

Enumerate events. Import only meaningful project/life context that is not already
represented by Granola or email:

```bash
brain --brain "$BRAIN_ROOT" --json import interaction --kind event \
  --title "Calendar: <event title>" \
  --occurred-at <start> --ended-at <end> \
  --location "<venue/address>" \
  --source google_calendar --external-id <event-id> \
  --original-url "<provider-url>" \
  --participant "attendee:Name <email>" \
  --self-participant "attendee:You <email>" \
  --link project:<id>
```

Use `event` for travel, lodging, reservations, reminders, all-day blocks, and
non-meeting schedule context. Use `meeting` for people-centered appointments.

### Contacts And People

Import trusted contacts with `brain add person` or cautious senders with
`brain add person-from-email`. When evidence supports it, include headline,
phone, location, organization, title, and current-employer hints at creation time
so profiles are not left blank:

```bash
brain --brain "$BRAIN_ROOT" --json add person-from-email \
  --full-name "Name" --email name@example.com \
  --source gmail --external-id <message-or-thread-id> \
  --headline "Picardo contact from Gmail correspondence" \
  --org "Example Labs" --org-domain example.com --title "Operations lead" \
  --current
```

Enrich existing people:

```bash
brain --brain "$BRAIN_ROOT" --json enrich person <id> \
  --headline "Picardo contact from Gmail correspondence" \
  --current-title "<title>" --role-family "<family>" --seniority "<level>"
```

Affiliations:

```bash
brain --brain "$BRAIN_ROOT" --json affiliate --person <person-id> --org <org-id> \
  --title "<title>" --department "<dept>" --role-family "<family>" \
  --seniority "<level>" --current --primary
```

Avoid speculative bios. Weak evidence can still support a weak headline such as
`Picardo contact from Gmail correspondence`.

### Organizations

Ensure durable organizations for accepted projects, recurring counterparties,
employers, vendors, venues, schools, and institutions. Use suggestions for weak
or high-impact inferred organizations.

```bash
brain --brain "$BRAIN_ROOT" --json add organization \
  --name "Example Labs" --domain example.com \
  --headline "Clinical lab partner" --source gmail --external-id example.com

brain --brain "$BRAIN_ROOT" --json enrich organization <org-id> \
  --headline "Clinical lab partner" \
  --one-line-description "Clinical testing provider for launch workflows." \
  --why-it-matters "Relevant to credentialing and ordering paths." \
  --source-urls-json '["https://example.com"]' \
  --model "agent-research" --prompt-fingerprint "org-profile-v1" \
  --source gmail
```

For companies, keep one company-level project unless the user explicitly accepts
subprojects. Do not create project-like organizations or organization-like
projects just because the same name appears in both roles.

### Assets And Attachments

Attach useful files to the record they came from. Provide extracted text when an
importer can safely read it; otherwise record the asset metadata and ledger the
text extraction gap.

```bash
brain --brain "$BRAIN_ROOT" --json add asset \
  --file ./attachment.pdf --kind attachment \
  --link interaction:<id> --text-file extracted.txt --text-source importer
```

Do not import sensitive attachments by default.

### Intelligence Writes

Every high-signal import should have narrative and structured intelligence with
citations. Prefer facts first, then promote only durable facts to memories.

```bash
brain --brain "$BRAIN_ROOT" --json add fact \
  --subject interaction:<id> --key decision \
  --value-text "<specific claim>" \
  --source-record interaction:<id> \
  --evidence interaction:<id>~"<short distinctive quote>"

brain --brain "$BRAIN_ROOT" --json promote fact <fact-id> \
  --memory-kind decision

brain --brain "$BRAIN_ROOT" --json tag ensure --name "Picardo"
brain --brain "$BRAIN_ROOT" --json tag attach --tag picardo --record interaction:<id>
```

## Completion And Audit

For every imported interaction/document:

```bash
brain --brain "$BRAIN_ROOT" --json import finalize --record interaction:<id>
```

If `complete:false`, either finish the missing stages, rerun finalize with the
narrow applicable waiver (`--raw-text-unavailable`, `--no-entities`,
`--no-project-or-task-link`, `--no-derived-actions`, or `--no-extracted-facts`),
or record `incomplete` with the missing array in the ledger.

End with:

```bash
brain --brain "$BRAIN_ROOT" --json doctor
brain --brain "$BRAIN_ROOT" --json import audit --limit 500
brain --brain "$BRAIN_ROOT" --json import-context --limit 300
brain --brain "$BRAIN_ROOT" --json suggest list
brain --brain "$BRAIN_ROOT" --json tasks plan-day --limit 25
```

Also run targeted searches for each accepted project, top people/orgs, and a few
known facts from every source.

Final report:

- target brain path verified;
- date/source coverage;
- ledger counts by source;
- documents/interactions/people/organizations/projects/tasks/facts/memories counts;
- person headline coverage;
- incomplete import audit results;
- suggestions created;
- known gaps and recommended next pass.
