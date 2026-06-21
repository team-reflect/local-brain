---
name: brain-backfill
description: Source-led first-run or large historical Local Brain import. Use when setting up a new brain from Gmail/GWS, Granola, Reflect notes, Calendar, contacts, or other personal data sources, especially when the user asks for a backfill or comprehensive import.
---

# Local Brain backfill skill

This skill is for the first substantial import into a Local Brain. It complements the
regular `brain` skill: read `skills/brain/SKILL.md` first, then use this playbook for
coverage, source enumeration, and audit discipline.

The goal is not to dump every byte. The goal is a durable, searchable local brain with
clear provenance, high-signal interactions/documents, useful people and organizations,
and an audit trail that says what was imported, skipped, duplicated, or left for review.

## Non-negotiables

1. **Use the correct brain.** Resolve the target folder up front and pass it to every
   write command:

   ```bash
   export BRAIN_ROOT="/path/to/brain-folder"
   cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json doctor
   cargo run -p brain-cli -- --brain "$BRAIN_ROOT" path
   ```

   Do not rely on the default app brain. If a worker writes to the wrong brain, stop
   and report it immediately; do not try to hide or hand-edit it.
2. **Use only the `brain` CLI for writes.** Do not write SQLite directly. The CLI owns
   dedupe, provenance, chunking, FTS, and invariants.
3. **Source-led beats search-led.** Enumerate records from the source first. Keyword
   search is a filter, not a coverage plan.
4. **Every source record gets a disposition.** Keep a local import ledger with:
   source, external id, date, title/from, status, linked project, and reason.
5. **People need headlines.** Treat person headline and affiliation enrichment as part
   of the import, not cleanup.
6. **Skip deliberately.** Secrets, passwords, 2FA codes, raw PHI-heavy attachments,
   receipts, promos, automated alerts, quoted chains, and private/family material
   should usually be skipped or redacted into a concise digest.

## Setup

Run these first:

```bash
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json doctor
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json contract
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json import-context --limit 200
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json self show
```

If `self.configured` is false, register known handles before importing email or
calendar data:

```bash
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json self set \
  --full-name "Alex MacCaw" \
  --email alex@maccaw.org --email alex@picardo.health --email alex@reflect.app
```

Adjust names/emails to the actual user and source evidence.

Ensure source slugs:

```bash
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json source ensure --slug gmail --name Gmail
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json source ensure --slug granola --name Granola
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json source ensure --slug reflect_notes --name "Reflect Notes"
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json source ensure --slug google_calendar --name "Google Calendar"
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json source ensure --slug google_people --name "Google People"
```

## Import Ledger

Create a local scratch ledger outside the brain database, for example:

```text
.codex-imports/backfill-ledger.tsv
```

Suggested columns:

```text
source    external_id    date    title    status    project    reason
```

Use statuses:

- `imported` - new visible record created.
- `refreshed` - source-backed existing record updated/refreshed.
- `duplicate` - already represented in the brain.
- `skipped` - intentionally skipped with a concrete reason.
- `needs_review` - ambiguous, sensitive, or project-shaped but not safe to write.

Final reports must include considered/imported/refreshed/duplicate/skipped/needs-review
counts by source, plus notable gaps.

## Source Passes

### 1. Projects And Boundaries

Start from accepted projects in `brain import-context`. Do not create new projects
during the backfill. If source evidence reveals a durable project candidate, use
`brain suggest project` and cite evidence; the user accepts it later.

For company-level grouping, prefer one project per company/product unless the user
asks for subprojects. Link sub-workstreams through interactions, tasks, memories, and
people rather than creating topic-bucket projects.

### 2. Granola

Enumerate all meetings in the date window with the Granola connector. For each meeting:

- Import project-relevant meetings as `interaction --kind meeting`.
- Use `--source granola --external-id <meeting-id>`.
- Fetch and store the raw transcript as body when available.
- Always pass a concise `--summary`.
- Link clear participants, people, and projects.
- Extract explicit tasks and stable memories with evidence.
- Mark skipped meetings in the ledger with reasons such as `private_family`,
  `fertility_private`, `travel`, `demo_noise`, or `no_project_match`.

Granola coverage is easy to audit: meeting count from the connector should roughly
match imported + duplicate + skipped + needs_review.

### 3. Gmail / GWS

Do not rely only on project keywords. For each month in scope:

1. Page thread/message metadata using Gmail connector or `gws`.
2. Cluster candidates by:
   - correspondent domain;
   - sender/recipient person;
   - subject stem;
   - known project keywords;
   - attachment presence.
3. Read high-signal candidate threads.
4. Import concise thread digests with:

   ```bash
   brain add interaction --kind email \
     --source gmail --external-kind thread --external-id <thread-id> \
     --title "Gmail: <short title>" \
     --summary "<digest>" \
     --text-file <redacted-digest.md> \
     --participant "from:Name <email>" \
     --link project:<id> \
     --json
   ```

Skip or redact:

- receipts, invoices, bank alerts, statements, account notifications;
- deployment/Sentry/Vercel noise unless it captures a real product incident;
- credentials, one-time links, passcodes, API keys, secrets;
- long quote chains and legal/medical boilerplate.

Still record counts for high-volume under-covered domains in the final report.

### 4. Reflect Notes

For Reflect-style local markdown exports:

1. Enumerate every daily note by filename in scope.
2. Search named notes for accepted project terms and known domains/people.
3. For each daily note, choose:
   - full document import, when it is mostly project reference material;
   - redacted digest document, when project signal is mixed with private journal;
   - skipped with reason, when there is no durable project signal;
   - needs review, when it is sensitive but likely important.
4. Use `--source reflect_notes --external-id <note-id-or-path>` when the CLI supports
   it; otherwise use stable titles and rely on document content dedupe.

Do not claim Reflect coverage from a handful of useful documents. Report daily notes
considered, imported, skipped, and needs-review.

### 5. Calendar

Use Calendar connector or `gws calendar` to enumerate events. Import only events that
represent meaningful project context:

- Picardo meetings without Granola notes;
- House appointments, deliveries, vendor walkthroughs;
- IEQ calls;
- Reflect/product meetings.

Use typed fields:

```bash
brain add interaction --kind event \
  --title "Calendar: <event title>" \
  --occurred-at <start> --ended-at <end> \
  --location "<venue/address>" \
  --source google_calendar --external-id <event-id> \
  --original-url "<provider-url>" \
  --participant "attendee:Name <email>" \
  --link project:<id> \
  --json
```

Skip travel, birthdays, reminders, routine holds, personal/family/fertility events, and
anything already represented by a Granola meeting unless the calendar record adds useful
typed fields.

### 6. Contacts And People Enrichment

Import trusted contacts and enrich existing people:

- full name;
- primary email and phone when available;
- organization/domain;
- title/current affiliation;
- conservative headline;
- source/external id.

Headline examples:

- `Picardo vendor contact for lab logistics`
- `House design contact`
- `IEQ advisor/contact`
- `Reflect product/growth contact`
- `Physician advising Picardo clinical workflows`

Avoid speculative bios. If evidence only supports a weak role, write a weak but useful
headline: `Picardo contact from Gmail correspondence`.

After enrichment, measure:

```bash
sqlite3 "$BRAIN_ROOT/brain.sqlite" \
  "select count(*) total,
          sum(headline is not null and trim(headline) <> '') with_headline,
          sum(headline is null or trim(headline) = '') missing_headline
   from people where archived_at is null;"
```

Do not edit SQLite directly; this query is read-only verification. If duplicate people
are found and the CLI has no merge command, report them rather than editing around the
CLI.

## Verification

Run final checks:

```bash
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json doctor
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json import-context --limit 200
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json suggest list
cargo run -p brain-cli -- --brain "$BRAIN_ROOT" --json tasks plan-day --limit 20
```

Run targeted searches for the main projects and several newly imported topics. Exact
topic searches are more reliable than broad multi-term searches.

Final report should include:

- target brain path verified;
- total counts: documents, interactions, people, organizations, projects, suggestions;
- source counts from `import-context`;
- people headline coverage;
- source-led coverage summary by source;
- skipped/needs-review categories;
- duplicate/dedupe issues;
- known remaining gaps and recommended next pass.

## Harness Guidance

When using subagents:

- give each worker a disjoint source or date window;
- require every worker to pass `--brain "$BRAIN_ROOT"` explicitly;
- tell workers they are not alone in the database and must not delete/revert;
- prefer source-backed external ids so concurrent workers dedupe safely;
- avoid many parallel SQLite writers for the same source if lock errors appear;
- have workers return counts and caveats, then run final verification in the parent.

If a worker is slow or inconclusive, stop it cleanly and report what did and did not
finish. A partial, audited backfill is better than a mysterious one.
