# Launch Schema

SQLite is the durable source of truth for Local Brain. The launch schema is a
typed personal intelligence database: durable people, organizations, projects,
tasks, documents, interactions, assets, raw evidence, AI artifacts, extracted
facts, curated memories, citations, tags, and universal retrieval chunks.

Markdown is not storage. Provider APIs are not part of the schema. Import agents
translate upstream records into generic typed writes through the CLI.

## Principles

- Model product nouns with typed tables, not a generic graph-node table.
- Preserve raw readable evidence in SQLite where available.
- Keep binary bytes in the managed assets directory; SQLite owns manifests,
  search text, links, and provenance.
- Keep projects user-agreed. Importers may create projects after explicit user
  sign-off, link existing projects, and propose unapproved candidates through
  suggestions, but must not auto-create topic buckets.
- Store narrative AI output separately from raw evidence.
- Treat extracted claims as append-only facts; promote only selected claims into
  curated hidden memories.
- Cite structure and claims through `evidence_refs` to exact `content_chunks`.
- Derive search and retrieval from universal chunks over every text-bearing
  record, not just documents and interactions.

## Baseline Migrations

The clean launch baseline is:

- `0001_core.sql` - typed records, provenance, relationships, facts, memories,
  tags, assets, and chat history.
- `0002_search.sql` - FTS5 projections, universal chunk FTS, sqlite-vec chunk
  vectors, and asset search projections.
- `0003_suggestions.sql` - user-facing curation queue for proposed structure.
- `0004_seed.sql` - built-in source rows.

Backwards compatibility with old `brain.sqlite` files is not required before
launch. Reimport from source instead of carrying old incremental migrations.

## Identity And Provenance

`sources` registers provider-neutral upstream systems such as `manual`, `agent`,
`gmail`, `granola`, `reflect_notes`, and `google_calendar`.

`external_identities` stores source-scoped identities for durable records:
`person`, `organization`, `organization_profile`, `project`, `task`, `document`,
`interaction`, `interaction_transcript`, `ai_note`, `extracted_fact`, `memory`,
and `asset`.

`record_provenance` stores import/enrichment metadata such as source, external
URL/path, imported time, model, prompt fingerprint, and opaque metadata JSON.

## People And Organizations

`people` stores rich profile fields: name, preferred name, headline, summary,
email/phone display caches, structured location, timezone, profile URLs,
important dates JSON, self flag, notes, relationship recency, and current
title/organization/department/role family/seniority caches.

`person_emails` and `person_phones` store normalized handles for dedupe and
multiple contact methods.

`organizations` stores name, kind, domain, headline, summary, website, industry,
location/HQ fields, notes, and archive state. Organizations do have a
`headline`: use it for a compact one-line description, while `summary` holds the
longer profile.

`affiliations` stores person-organization history with title, department, role,
role family, seniority, started/ended dates, current/primary flags, notes, and
optional evidence pointer. Current/primary affiliations synchronize the person
cache.

`organization_profiles` stores AI/research enrichment rows: canonical name,
website, one-line description, category, why it matters, offerings JSON, notable
people JSON, suggested tags JSON, review flags JSON, source URLs JSON, raw
enrichment JSON, model, prompt fingerprint, and researched time.

## Work And Relationships

`projects` are generic workstreams or life areas. They collect people,
organizations, documents, interactions, tasks, assets, facts, and memories through
typed links. Do not add company-specific partnership tables.

`tasks` are commitments, waiting items, reminders, and follow-ups. They may link
to one project, people, organizations, documents, interactions, and exact
evidence chunks.

Typed join tables link people, organizations, projects, tasks, documents,
interactions, assets, memories, tags, and source records. The graph surface is
derived from these typed records and links, centered on the user's self person.

## Evidence And Intelligence

`interactions` stores meetings, calls, emails, messages, events, and notes with a
readable title, summary, structured timing/location, metadata, and optional body
text.

`interaction_transcripts` stores full raw transcript text, speaker segments JSON,
language, transcript source, recording/storage metadata, content hash, and source
identity. A meeting/email import can have both an interaction summary and a raw
transcript.

`documents` stores durable reference artifacts: notes, files, memos, plans,
receipts, webpages, and imported readable text.

`ai_notes` stores narrative AI artifacts: summaries, action items, decisions,
risks, highlights, coaching, and other generated notes. Each note anchors to
exactly one interaction, document, or typed subject.

`extracted_facts` stores append-only structured claims with subject, key,
text/JSON value, confidence, observed time, source record, source excerpt, model,
prompt fingerprint, and metadata.

`memories` stores curated hidden claims, either written directly or promoted from
facts. Memories are not a dump of all extracted claims.

`evidence_refs` cites exact chunks/spans from tasks, memories, facts, AI notes,
profile fields, and other typed subjects.

## Search And Retrieval

`content_chunks` is the universal retrieval surface. It chunks text-bearing
records of type:

```text
person, organization, organization_profile, project, task,
document, interaction, interaction_transcript, ai_note,
extracted_fact, memory, asset
```

`content_chunks_fts` provides lexical search over chunks. `chunk_embeddings` and
`chunk_vectors` provide sqlite-vec semantic retrieval. Retrieval returns the chunk
plus its owning typed record, source record, snippet, score, and citation handle.

Documents, interactions, and assets also keep navigational FTS projections for
global search and quick UI lookup.

## Suggestions

`suggestions` is a user-facing curation queue, not an automation log. It is for
inferred or not-yet-approved structure an importer must not auto-create, such as
a possible project boundary, a high-impact organization, an affiliation, or a
merge proposal.

Every suggestion must be actionable and cite evidence. Accepting a suggestion
performs the typed write and relinks cited records. Dismissals are durable so a
proposal is not re-raised.

## CLI Completion Rule

An imported meeting, email, or document is incomplete until it has:

- source identity;
- participants or entities where applicable;
- raw text where available;
- at least one AI note;
- extracted facts;
- links to existing projects or tasks when relevant;
- evidence-backed tasks or memories when claims/actions were derived;
- tags;
- retrieval chunks;
- a passing `brain --json import finalize --record kind:id` result.

`brain import audit --json` reports records that still miss these staged import
requirements. `brain import finalize` supports narrow explicit waivers for
source limitations (`--raw-text-unavailable`, `--no-entities`,
`--no-project-or-task-link`, `--no-derived-actions`, and
`--no-extracted-facts`) and writes durable `finalized` provenance when a record
passes.
