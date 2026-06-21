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
7. Skip deliberately: secrets, passwords, one-time links, medical/financial
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
- maintain its own ledger shard;
- run `brain --json import finalize --record kind:id` on every imported record,
  adding only narrow explicit waivers when source data is truly absent;
- report incomplete records instead of hiding them.

Merge ledger shards at the end and run one global audit.

## Source Passes

### Projects And Boundaries

Start from accepted projects in `import-context`. Group each company/product as
one project unless the user explicitly asks for subprojects. If the user has
already agreed to a project boundary, create it with `brain add project` and
link later imports to it. Otherwise do not auto-create projects during import;
use `brain suggest project` with evidence.

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
  --title "Meeting summary" --text-file summary.md --source granola
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
  --participant "from:Name <email>" \
  --link project:<id>
```

Skip credentials, codes, receipts, promos, alerts, long quoted chains, and
legal/medical boilerplate unless they contain durable project intelligence.

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
  --link project:<id>
```

If the CLI does not yet expose source identity on documents, rely on content
dedupe and note the gap in the ledger.

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
`brain add person-from-email`. Enrich existing people:

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
