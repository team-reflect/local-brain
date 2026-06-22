# Using Codex To Backfill Local Brain

This guide is for users who want Codex to import historical context into Local
Brain from sources like Gmail, Google Workspace, Granola, WhatsApp, iMessage,
Reflect notes, Google Calendar, contacts, or local files.

The short version: ask Codex for a bounded source-led backfill, give it the source
or connector to use, and make it finish with an audit. Codex already has agent
skills for the details; your job is to set the scope, approve the kinds of data
that should be imported, and review the final report.

## What A Backfill Does

A good backfill turns old source data into useful Local Brain records:

- interactions, such as email threads, meetings, calendar events, chats, calls,
  and messages;
- documents, such as notes, PDFs, plans, receipts, or exported text;
- people and organizations, when there is enough evidence that they matter;
- project links, tags, summaries, facts, memories, and tasks where appropriate;
- full source text or transcripts when the source has readable content.

A backfill should not be a blind dump. Codex should skip low-signal or sensitive
records, preserve raw evidence for imported records, and keep an audit trail of
what it imported, skipped, refreshed, or left for review.

## Before You Start

Make sure Codex can access the source you want to import:

- Gmail or Google Workspace: mention `gws` or the Gmail connector.
- Granola: mention the Granola connector.
- WhatsApp or iMessage: point Codex at the local SQLite database or export.
- Reflect notes or local files: provide the folder path.
- Calendar: mention Google Calendar or `gws`.

Decide the scope before starting. Good scopes include:

- "the last year of Gmail and Granola";
- "all WhatsApp history from the local SQLite file";
- "Reflect notes under this folder";
- "sent Gmail threads about Picardo since January";
- "calendar events for travel in 2025 and 2026".

If this is a first-time brain setup, expect Codex to ask about your core project
boundaries before importing. Projects are durable structure, so Codex should not
invent them without your sign-off.

## The Prompt To Use

Use a prompt like this:

```text
Use $brain and $brain-backfill to backfill Local Brain from <source>.

Scope:
- Source: <Gmail / Granola / WhatsApp SQLite / Reflect folder / Calendar / files>
- Date range: <all time / last year / specific dates>
- Coverage goal: <full import / high-signal only / specific project or topic>
- Sensitive data rules: <what to skip>

Please:
- verify the target brain first;
- enumerate source records before importing;
- keep local pass artifacts and a ledger;
- preserve full readable text or transcripts for imported records;
- link existing people, organizations, and projects where possible;
- do participant normalization and cleanup;
- finish with import audits and a concise report.
```

Example:

```text
Use $brain and $brain-backfill to do a one-year backfill from Gmail and Granola.
Prefer high-signal project, relationship, decision, meeting, and follow-up
records. Skip receipts, login codes, promotions, commodity notifications, and
sensitive personal material unless clearly tied to an accepted project.

Use gws for Gmail. Store full Granola transcripts as well as summaries. Finish
with participant normalization, import audit, and a final report.
```

For a local database:

```text
Use $brain and $brain-backfill to do a full WhatsApp import from the local
WhatsApp SQLite file. Do not be afraid of importing a lot of data from this
source. Preserve full transcripts, source identities, participants, media
metadata, summaries, tags, project links, and a final audit report.
```

## How To Steer Codex During The Backfill

Codex should give progress updates while it works. Useful things to ask:

- "What brain are you writing to?"
- "What source records did you find before importing?"
- "What are you skipping and why?"
- "How are you grouping this source?"
- "Are you importing full text/transcripts?"
- "Which existing projects are you linking?"
- "What participant candidates remain unresolved?"
- "Show me the final report and skipped counts."

For very large sources, it is normal for Codex to import in chunks such as by
month, source folder, thread, meeting, or chat. That makes the import resumable
and keeps individual records readable.

## What Codex Should Produce

At the end, Codex should report:

- target brain path;
- source and date coverage;
- number of source records considered, imported, refreshed, skipped, duplicated,
  incomplete, or left for review;
- people, organizations, projects, facts, tasks, memories, tags, and interactions
  created or updated;
- participant normalization actions and remaining unresolved candidates;
- skipped-sensitive-data rules used;
- import audit results;
- known gaps and recommended next passes.

For each bounded source pass, Codex should also keep local artifacts such as:

```text
.codex-imports/<pass-name>/
  manifest.jsonl
  decisions.jsonl
  decisions.tsv
  import-ledger.tsv
  report.md
  raw/
  text/
```

These files are not the brain itself. They are an audit trail so the pass can be
reviewed, resumed, or debugged.

## Safety Rules Worth Enforcing

Ask Codex to follow these rules if the source is personal or sensitive:

- Do not import passwords, one-time login codes, recovery links, or secrets.
- Do not partially redact imported bodies. If a source record should not be in
  the brain, skip the whole record and ledger the reason.
- Do not create a person for every email address or chat handle.
- Do not create a project unless you approved that project boundary.
- Do not write directly to the Brain SQLite database. Writes should go through
  the `brain` CLI.
- Do not treat message IDs, thread IDs, meeting IDs, or file IDs as person or
  organization IDs.

## What "Done" Looks Like

A backfill is done when:

- imported records have source identities, readable evidence, summaries or notes,
  tags, links, and finalization;
- recurring people and organizations have been normalized or ledgered as
  unresolved;
- duplicate people have been merged or explicitly left alone;
- the import audit is clean, or every remaining incomplete record has an
  explanation;
- the participant audit is clean, or every remaining candidate has a reason;
- Codex gives you a final report with counts and known gaps.

If Codex says an audit is not clean, that is not always failure. Sometimes the
right result is a cleanly documented limitation, such as a source-native chat
handle that cannot be safely mapped to a real person yet.

## Cleanup And Enrichment Passes

The first pass gives Local Brain coverage. Follow-up passes make that coverage
more useful. Good cleanup passes are narrow, evidence-led, and safe to rerun.

Ask Codex to use the CLI cleanup primitives instead of editing SQLite directly:

```bash
brain --json merge person --from <duplicate-person-id> --to <canonical-person-id> \
  --dry-run
brain --json merge person --from <duplicate-person-id> --to <canonical-person-id> \
  --reason "duplicate shell from backfill"
brain --json person rename <person-id> --full-name "Correct Name"
brain --json person email add <person-id> --email <email>
brain --json person phone add <person-id> --phone <phone>
brain --json repair person-email move --email <email> \
  --from <wrong-person-id> --to <canonical-person-id> --relink-participants
brain --json repair person-phone move --phone <phone> \
  --from <wrong-person-id> --to <canonical-person-id> --relink-participants
brain --json repair participants relink --handle <email-or-phone> \
  --person <canonical-person-id> --from-person <wrong-person-id>
brain --json unlink person:<id> organization:<id> --reason "mistaken affiliation"
brain --json archive person <person-id> --reason "mistaken person import"
brain --json archive organization <org-id> --reason "mistaken organization import"
```

Always inspect the `warnings[]` array from `merge person --dry-run` before
applying a merge. Warnings mean some owned handle, external identity, or other
record was intentionally skipped or blocked; ledger that decision instead of
assuming the merge was complete. Add `--force` to participant relink only when
the target is already linked in the same interaction and the wrong-person row
should be merged away.

For user-provided corrections, ask Codex to store a small evidence document and
source-keyed facts before updating profiles. For example, if you say "Charlotte
is my mother", Codex should store that statement as manual evidence, add a
source-keyed `relationship_to_alex` fact, update Charlotte's person profile, tag
her if useful, and rerun `brain --json import audit`.

For enrichment, use a prompt like:

```text
Do a people enrichment pass. Prioritize sparse profiles, recurring participants,
Friend CRM contacts, family and household contacts, and high-signal public
people. Use existing brain evidence first, then contacts, Gmail, Granola, or
public web only where the match is safe. Add summaries, relationship facts, tags,
contact handles, organization affiliations, and source-keyed public-profile
facts. Ledger unresolved cases and finish with import audit.
```

Unresolved is a valid finished state when identity evidence is weak. Pair labels
such as "Laura + Chris", ambiguous first names, shared mailboxes, and opaque chat
handles should be ledgered as unresolved rather than split into invented people.

## Common Follow-Up Requests

After a broad backfill, it is often useful to ask for a narrower cleanup pass:

```text
Use gws to find everyone I emailed about rafting and tag those people with rafting.
```

```text
Review the participant audit and merge obvious duplicate people, using dry-run
first for every merge.
```

```text
Find imported records linked to Personal that look like they belong to Picardo,
Reflect, House, Travel, Finance, or Health, and propose fixes before writing.
```

```text
Search the imported WhatsApp and Gmail records for commitments I made but that
did not become tasks.
```

Backfills get better through these small cleanup loops. The first pass gives
Local Brain coverage; the follow-up passes turn coverage into a more useful
personal graph.
