---
name: brain-backfill
description: Source-led first-run or large historical Local Brain import. Use when setting up a new brain from Gmail/GWS, Granola, WhatsApp, Reflect notes, Calendar, contacts, or other personal data sources, especially when the user asks for a comprehensive backfill.
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
9. For people and organizations, `--external-id` must identify that person/org
   itself. Never use a Gmail thread/message id, meeting id, event id, note id, or
   other source-record id as a person/org external id.
10. Completion requires participant normalization: run the participant audit,
    promote recurring real people, and rerun the fail gate before final report.
11. Skip deliberately: secrets, passwords, one-time links, medical/financial
   boilerplate, promos, alerts, receipts, and private material usually do not
   belong in the brain. Do not redact imported source bodies; if a source record
   should not be stored locally, skip the whole record and ledger the reason.
12. User corrections and clarifications are trusted manual evidence. Store them
    as small manual evidence records, add source-keyed facts, update typed
    profiles/tags/affiliations through the CLI, and keep import audit clean.

## Setup

```bash
brain --brain "$BRAIN_ROOT" --json import-context --limit 300
brain --brain "$BRAIN_ROOT" --json self show
brain --brain "$BRAIN_ROOT" --json source ensure --slug gmail --name Gmail
brain --brain "$BRAIN_ROOT" --json source ensure --slug granola --name Granola
brain --brain "$BRAIN_ROOT" --json source ensure --slug reflect_notes --name "Reflect Notes"
brain --brain "$BRAIN_ROOT" --json source ensure --slug google_calendar --name "Google Calendar"
brain --brain "$BRAIN_ROOT" --json source ensure --slug google_people --name "Google People"
brain --brain "$BRAIN_ROOT" --json source ensure --slug whatsapp --name WhatsApp
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

After project sign-off and self setup, rerun `import-context` and save a
baseline snapshot from that fresh output before importing. Do not reuse the
earlier setup output.

```bash
brain --brain "$BRAIN_ROOT" --json import-context --limit 300
```

```text
baseline_projects=<count>    baseline_people=<count>    baseline_orgs=<count>
accepted_projects=<ids/names from import-context>
```

## Ledger

Use a scratch file such as `.codex-imports/backfill-ledger.tsv`:

```text
source    external_id    date    title    status    project    reason    local_record
```

Also keep compact normalization ledgers:

```text
person_candidate    source    handle_or_name    count    action    person_id_or_reason
org_candidate       source    domain_or_name     count    action    org_id_or_reason
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
needs-review/incomplete counts by source and notable gaps. Source workers must
also report person/org records created and unresolved person/org candidates.

For every bounded source pass, create a pass directory under `.codex-imports/`
before importing. Keep the pass auditable and resumable:

```text
<pass-name>/
  manifest.jsonl       every fetched source record and local raw/text paths
  review-queue.jsonl   compact evidence for LLM/manual decisions
  decisions.jsonl      import/skip/duplicate/needs_review with reason
  decisions.tsv        human-readable decision ledger
  import-ledger.tsv    attempted imports and finalize results
  report.md            query/window/cap/counts/normalization caveats
  raw/                 raw provider JSON
  text/                readable source text used for imports
```

Before marking a source record as fresh, dedupe against every prior ledger shard
and pass-specific `import-ledger.tsv`, not only the first backfill ledger.
Report provider result estimates, explicit caps, fetched count, imported count,
and the unreviewed remainder.

## Parallelization

For large backfills, use subagents/workers when available. Split independent
import lanes by source and month. After import, use subagents for read-only
normalization/audit candidate lanes such as people candidates, org/domain
candidates, and project surprises.
Every subagent/worker must:

- receive the same `BRAIN_ROOT`;
- read `brain --json import-context` and the read-first context at start;
- maintain its own disjoint ledger shard.

Import workers must:

- own a disjoint write scope with no overlapping source records;
- write through the CLI only;
- use source identity for idempotence;
- use `--refresh` for routine source-backed reimports, and `--replace-body`
  only when intentionally overwriting stale imported body text;
- run `brain --json import finalize --record kind:id` on every imported record,
  adding only narrow explicit waivers when source data is truly absent;
- report incomplete records instead of hiding them.

Normalization/audit workers must:

- avoid writes; they produce candidate ledgers only;
- own a disjoint read-only candidate scope, such as people, org/domain, or
  project-surprise candidates;
- audit recurring unresolved participants, domains, and project count surprises;
- report unresolved participants, unresolved domains, and recommended actions.

The main coordinator merges ledger shards, performs any people/org/affiliation
normalization writes through the CLI, then runs one global audit. Use
`brain import participants audit/promote` and `brain repair ...` commands for
participant normalization rather than direct SQLite writes.

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

Default Gmail strategy: run `from:me` first. Sent threads are usually denser
relationship signal than broad keyword search because they capture what the user
chose to reply to, introduce, approve, explain, or coordinate. Treat it as a
bounded source pass, not as the whole backfill:

```text
pass_name=from-me-gmail
query=from:me after:<YYYY/MM/DD> before:<YYYY/MM/DD>
cap=<explicit number, e.g. 500>
```

After `from:me`, add narrower passes as needed: `is:important`, recurring
correspondents/domains, attachment-heavy project threads, and explicit user
queries. Do not rely only on project keywords. For each Gmail pass:

1. Page thread/message metadata.
2. Fetch full raw thread JSON and readable thread text into the pass directory.
3. Build a compact review queue from subject, dates, participants, labels,
   message count, attachments, snippets, and text excerpts.
4. Dedupe against previous ledgers and source identities.
5. Cluster by correspondent domain, sender/recipient, subject stem, known
   projects, attachments, and thread depth.
6. Review high-signal threads case by case.
7. Import full readable thread text as `interaction --kind email` when the
   source record is worth storing.
8. Preserve participants, source identity, project links, AI note, facts, tags,
   and evidence-backed tasks/memories.

Example:

```bash
brain --brain "$BRAIN_ROOT" --json import interaction --kind email \
  --title "Gmail: <short subject>" \
  --summary "<digest>" \
  --text-file full-thread.md \
  --source gmail --external-kind thread --external-id <thread-id> \
  --participant "from:Name <email>" --participant "to:Alex <email>" \
  --link project:<id>
```

Import sent threads that carry durable project, relationship, obligation,
decision, strategy, introduction, approval, or vendor coordination signal. Skip
credentials, codes, receipts, promos, alerts, commodity confirmations, calendar
noise, self-authored daily digests, long quoted chains, and legal/medical/
family/private material unless the user has explicitly approved it or it
clearly belongs to an accepted project and is worth storing as complete local
evidence. Use `--refresh` for repeat passes over the same thread so unchanged
bodies stay idempotent.

### Reflect Notes

Enumerate every note in scope by path/date. For each note choose one:

- full `import document` when mostly reference material;
- `skipped` with a concrete reason when project signal is mixed with private
  material that should not be stored locally;
- `needs_review` when sensitive but likely important.

Use stable source identity:

```bash
brain --brain "$BRAIN_ROOT" --json import document \
  --title "Reflect: <note title>" \
  --text-file note.md \
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
  --text-file full-calendar-event.txt \
  --metadata-json-file raw-google-calendar-event.json \
  --event-json-file event-details.json \
  --source google_calendar --external-id <event-id> \
  --original-url "<provider-url>" \
  --participant "attendee:Name <email>" \
  --self-participant "attendee:You <email>" \
  --link project:<id>
```

Use `event` for travel, lodging, reservations, reminders, all-day blocks, and
non-meeting schedule context. Use `meeting` for people-centered appointments.
If the calendar body only says "see Gmail for details", fetch and import the
linked Gmail source or leave the event incomplete with `--raw-text-unavailable`
and a ledger note.

### iMessage / Apple Messages

For local Apple Messages backfills, treat `~/Library/Messages/chat.db` as the
source of truth and read it with SQLite in read-only mode. Ensure a dedicated
source first:

```bash
brain --brain "$BRAIN_ROOT" --json source ensure \
  --slug imessage --name iMessage
```

Import one Brain interaction per Apple `chat`, not one interaction per message.
Use `--kind message`, `--source imessage`, `--external-kind chat`, and a stable
`--external-id` such as `chat.guid`. Keep a per-chat ledger and preserve the
complete recovered transcript in the interaction body.

Apple Messages has two important text paths:

- `message.text` contains only part of the readable history.
- many text messages only appear in `message.attributedBody`; extract that text
  before deciding a row is blank.

Convert Apple timestamps as nanoseconds since `2001-01-01T00:00:00Z`. Preserve
reactions, replies, system rows, and empty/media-only rows as transcript lines
when they carry context. For attachments, include filenames, MIME types, sizes,
and local paths in the transcript and metadata. Do not bulk-copy every image,
video, sticker, or audio file into Brain unless the user explicitly asks for
binary asset import; message media can be huge and is often not searchable
without a separate extraction pass.

Use local Contacts/AddressBook data to enrich chat handles into names when the
match is safe, but keep opaque phone/email handles as unresolved participants
until the participant audit supports promotion. After import, add an `iMessage`
tag, a concise archive AI note for each chat, finalize with narrow waivers when
the pass intentionally skips project/action/fact extraction, then run
participant audit and `merge person --dry-run` / `merge person` for duplicate
contact shells.

### WhatsApp

For local WhatsApp backfills, copy the source database and its `-wal` / `-shm`
companions into the pass directory before reading it. Common macOS sources are
under `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/`, with
`ChatStorage.sqlite` as the main SQLite database. Treat the copied database as
read-only source material and write to Brain only through the CLI:

```bash
brain --brain "$BRAIN_ROOT" --json source ensure \
  --slug whatsapp --name WhatsApp
```

Inspect the schema before extraction; WhatsApp Core Data table names vary by
version. Common useful tables include `ZWAMESSAGE`, `ZWACHATSESSION`,
`ZWAGROUPMEMBER`, `ZWAMEDIAITEM`, and `ZWAPROFILEPUSHNAME`. Convert WhatsApp
Core Data timestamps as seconds since `2001-01-01T00:00:00Z` by adding
`978307200` seconds.

For small or high-signal chats, import one interaction per chat. Use one
interaction per chat-month when a transcript would exceed roughly 10,000
messages or 5 MB of Markdown, or when one chat would dominate search chunks and
summaries:

```bash
brain --brain "$BRAIN_ROOT" --json import interaction --kind message \
  --title "WhatsApp: <chat name> (<YYYY-MM>)" \
  --summary "<concise archive summary>" \
  --text-file transcript.md \
  --metadata-json-file metadata.json \
  --source whatsapp --external-kind chat_month \
  --external-id "<chat-jid>:<YYYY-MM>" \
  --participant "sender:<display name or handle>" \
  --link project:<id>
```

Preserve the full readable transcript in the body: local timestamp, sender,
text, deleted/system markers, media captions, media filenames/paths, quoted
reply context when available, and message ids or stanza ids in metadata. Do not
bulk-import WhatsApp media binaries by default; record media metadata and local
paths, then attach selected files only when the user explicitly wants binary
assets or the file is clearly durable evidence.

Participant handling is the fragile part. For direct chats, prefer phone-backed
JIDs when present. For group chats, sender identity usually comes from group
member rows such as `ZMEMBERJID`, not the group chat JID. Preserve source-native
handles like `<phone>@s.whatsapp.net`, group JIDs, and opaque `@lid` handles as
participants. Use contacts, push names, repeated context, and phone numbers to
promote safely; do not create people for every group member. Ledger unresolved
LID-only handles and recurring group participants for the final participant
audit.

After import, add a `WhatsApp` tag, source-keyed AI notes, facts/tasks/memories
only where evidence is durable, and finalize each interaction. For archive-only
chat-month imports, use narrow waivers such as `--no-derived-actions`,
`--no-extracted-facts`, or `--no-project-or-task-link` rather than inventing
intelligence. Run `brain import participants audit --source whatsapp` and
report unresolved handles, promoted people, relinks, and skipped media.

### Contacts And People

Import trusted contacts with `brain add person` or cautious senders with
`brain add person-from-email`. When evidence supports it, include headline,
phone, location, organization, title, and current-employer hints at creation time
so profiles are not left blank:

```bash
brain --brain "$BRAIN_ROOT" --json add person-from-email \
  --full-name "Name" --email name@example.com \
  --source gmail \
  --headline "Picardo contact from Gmail correspondence" \
  --org "Example Labs" --org-domain example.com --title "Operations lead" \
  --current
```

Only include `--external-id` for `add person` or `person-from-email` when it is
a stable upstream person/contact id, such as a Google People contact id. A Gmail
message id or thread id belongs on `import interaction`, not on the person.

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
  --headline "Clinical lab partner" --source gmail --external-kind domain --external-id example.com

brain --brain "$BRAIN_ROOT" --json enrich organization <org-id> \
  --headline "Clinical lab partner" \
  --one-line-description "Clinical testing provider for launch workflows." \
  --why-it-matters "Relevant to credentialing and ordering paths." \
  --source-urls-json '["https://example.com"]' \
  --model "agent-research" --prompt-fingerprint "org-profile-v1" \
  --source gmail
```

Only use an organization external id when the identity is for the organization
itself, such as a normalized domain or a stable org/contact-provider id. Do not
reuse the source email/thread/meeting/event id that merely mentioned the org.

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
  --source <source-slug> --external-kind extracted-fact \
  --external-id "<source-record-id>:decision:<stable-key>" \
  --source-record interaction:<id> \
  --evidence interaction:<id>~"<short distinctive quote>"

brain --brain "$BRAIN_ROOT" --json promote fact <fact-id> \
  --memory-kind decision

brain --brain "$BRAIN_ROOT" --json tag ensure --name "Picardo"
brain --brain "$BRAIN_ROOT" --json tag attach --tag picardo --record interaction:<id>
```

## Entity Normalization Gate

After source passes and before declaring completion, merge worker candidate
ledgers and normalize people/orgs. This is mandatory, not optional cleanup.
The coordinator owns normalization writes; worker ledgers are inputs.

People ledger:

```text
candidate    evidence_count    source_handles    action
Jane Doe     9                 jane@example.com  linked person:<id>
J. Doe       3                 jdoe@example.com  duplicate of person:<id>
Unknown      5                 no email          unresolved: weak identity
```

Org/domain ledger:

```text
candidate         evidence_count    domains              action
Example Labs      12                example.com          linked org:<id>
consultant.co     6                 consultant.co        suggested:<id>
gmail.com         40                gmail.com            unresolved: consumer domain
```

Audit for recurring unresolved participants/domains across all imported records.
Create/enrich only when evidence is sufficient; otherwise create
evidence-backed suggestions or leave unresolved with a reason. If normalization
changes an entity after imports are linked, relink affected records with the CLI
repair commands.

Required participant audit flow:

```bash
brain --brain "$BRAIN_ROOT" --json import participants audit --min-count 2 --limit 300
brain --brain "$BRAIN_ROOT" --json import participants promote \
  --handle jane@example.com --full-name "Jane Doe" \
  --headline "Picardo contact from imported correspondence"
brain --brain "$BRAIN_ROOT" --json repair participants relink \
  --handle jane@example.com --person <person-id>
brain --brain "$BRAIN_ROOT" --json repair person-email move \
  --email jane@example.com --from <wrong-person-id> --to <right-person-id> \
  --relink-participants
brain --brain "$BRAIN_ROOT" --json repair person-phone move \
  --phone "+1 555 0100" --from <wrong-person-id> --to <right-person-id> \
  --relink-participants
brain --brain "$BRAIN_ROOT" --json import participants audit \
  --min-count 2 --fail-on-promote-candidates
```

If the fail gate still reports promote candidates, the backfill is incomplete
unless each remaining candidate is explicitly ledgered as unresolved with a
reason.

Promotion judgment:

- Promote real people with repeated meaningful contact, known relationship, or
  durable future relevance.
- Use thread headers/signatures to recover names; do not invent names from
  opaque handles.
- Leave shared/vendor/service handles unresolved with reasons, such as
  `shared mailbox`, `project mailbox`, `fund/admin mailbox`, `no-reply`, or
  `ambiguous local evidence`.
- If promotion creates the wrong duplicate person, use
  `repair person-email move --relink-participants` to move the email back to
  the canonical person and relink old participant rows.

Use merge/archive/link cleanup primitives for duplicate shells and mistaken
entities. Always dry-run merges before applying them:

```bash
brain --brain "$BRAIN_ROOT" --json merge person \
  --from <duplicate-person-id> --to <canonical-person-id> --dry-run
brain --brain "$BRAIN_ROOT" --json merge person \
  --from <duplicate-person-id> --to <canonical-person-id> \
  --reason "duplicate shell from backfill"

brain --brain "$BRAIN_ROOT" --json repair participants relink \
  --handle wrong@example.com --person <right-person-id> \
  --from-person <wrong-person-id>
brain --brain "$BRAIN_ROOT" --json unlink person:<person-id> organization:<org-id> \
  --reason "org field contained a city"
brain --brain "$BRAIN_ROOT" --json archive organization <org-id> \
  --reason "mistaken organization import"
brain --brain "$BRAIN_ROOT" --json archive person <person-id> \
  --reason "mistaken person shell"
```

Add `--force` to participant relink only when the target is already linked in the
same interaction and the wrong-person participant row should be merged away.

Person merges move source identities to the canonical target but preserve source
provenance on the archived duplicate; use the target merge provenance event for
the cleanup audit trail.

For source-derived low-level facts, use stable `--source` / `--external-id`
keys and pass `--refresh` on reruns that should replace the same imported fact.
Do not patch `interaction_participants`, handles, affiliations, or archive
state directly in SQLite.

Run a no-surprise-project audit: compare final projects to the baseline plus
explicitly user-approved creations. Any unapproved project created during the
backfill blocks completion; convert it to an evidence-backed suggestion or
unlink/archive the mistaken records with the cleanup commands above.

## Follow-Up Enrichment Passes

After broad source coverage is in place, run targeted enrichment passes for
sparse but important people and organizations. Prioritize recurring
participants, known friends/family/household contacts, accepted-project
counterparties, and high-signal public people. Use existing brain evidence
first; use contacts, Gmail, Granola, calendar, or public web only when identity
is safe.

For each confident enrichment:

- add or refresh a source-keyed fact for the specific claim;
- update summaries, headlines, relationship facts, contact handles, tags,
  organization affiliations, and public-profile facts through the CLI;
- store small public/manual evidence documents when the claim comes from outside
  already-imported source records;
- finalize new evidence documents with narrow waivers when they are pure
  reference/profile evidence and do not imply tasks or projects.

Ledger weak cases rather than inventing structure. Pair labels, ambiguous first
names, shared mailboxes, opaque chat handles, and public-profile near-matches
should remain unresolved with reasons until there is safe identity evidence.

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
brain --brain "$BRAIN_ROOT" --json import participants audit \
  --min-count 2 --fail-on-promote-candidates
brain --brain "$BRAIN_ROOT" --json import-context --limit 300
brain --brain "$BRAIN_ROOT" --json suggest list
brain --brain "$BRAIN_ROOT" --json tasks plan-day --limit 25
```

Also run targeted searches for each accepted project, top people/orgs, and a few
known facts from every source.

Completion is blocked until:

- every imported record is finalized or ledgered incomplete;
- people/org normalization ledgers are complete;
- recurring unresolved participants/domains are audited and the participant
  promotion fail gate is clean or explicitly ledgered;
- project count changes match approved creations only;
- a fresh final `import-context` is compared to the baseline snapshot.

Final report:

- target brain path verified;
- date/source coverage;
- ledger counts by source;
- baseline vs final project/person/org counts;
- documents/interactions/people/organizations/projects/tasks/facts/memories counts;
- person headline coverage;
- people/orgs created during import and coordinator normalization;
- unresolved participant/domain gaps and reasons;
- no-surprise-project audit result;
- participant promotion/repair actions and affected row counts;
- incomplete import audit results;
- suggestions created;
- provider result estimates, caps, and unreviewed remainder for bounded passes;
- decision rules used for high-signal source passes such as `from:me`;
- known gaps and recommended next pass.
