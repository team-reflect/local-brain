# Launch Schema

SQLite is the durable source of truth for Local Brain. The launch schema is a personal
CRM with first-class people, organizations, projects, tasks, interactions, documents,
asset metadata, hidden atomic memories, tags, and settings.

The schema should make everyday questions easy:

- Who did I talk to, and what did we decide?
- What am I waiting on?
- What projects are active?
- What documents and conversations explain this?
- What does my AI know, and what evidence supports it?

## Schema Principles

- Use typed tables for product nouns instead of a generic graph-node layer.
- Store imported readable text directly in SQLite.
- Store binary asset bytes as app-managed files under the chosen brain root; SQLite owns
  the asset manifest, typed links, provenance, and deletion state.
- Store optional asset-derived text in SQLite so imported attachments can be searched
  without making binary bytes the database payload.
- Preserve provenance on the record that owns the text.
- Derive chunks for search and embeddings from documents and interactions.
- Keep memories hidden by default and link them to visible records.
- Cite answers through evidence references to document or interaction chunks.
- Keep launch privacy simple: no row-level sensitivity labels.

## Core Tables

### `people`

People the user knows or needs to remember.

Key columns:

- `id`
- `full_name`
- `preferred_name`
- `headline`
- `primary_email`
- `primary_phone`
- `location`
- `is_self`
- `last_interaction_at`
- `important_dates_json`
- `summary`
- `notes`
- `avatar_asset_id`
- `current_organization_id`
- `created_at`
- `updated_at`
- `archived_at`

`primary_email` and `primary_phone` remain fast display fields. Durable imports store
multiple handles in `person_emails` and `person_phones`.

### `person_emails` and `person_phones`

Multiple contact handles for a person. Importers use normalized values for dedupe while
preserving the original display value.

Shared key columns:

- `id`
- `person_id`
- display value (`email` or `phone`)
- normalized value (`normalized_email` or `normalized_phone`)
- `label`
- `is_primary`
- `source_id`
- `created_at`
- `updated_at`

### `organizations`

Companies, teams, schools, clubs, vendors, government bodies, and other groups.

Key columns:

- `id`
- `name`
- `kind`
- `domain`
- `location`
- `summary`
- `notes`
- `logo_asset_id`
- `created_at`
- `updated_at`
- `archived_at`

### `affiliations`

Time-bound links between people and organizations.

Key columns:

- `id`
- `person_id`
- `organization_id`
- `title`
- `role`
- `started_on`
- `ended_on`
- `is_current`
- `notes`
- `created_at`
- `updated_at`

### `projects`

Personal or professional work areas that the user deliberately creates or approves. A
project is not a task tag or agent-inferred topic bucket: it is the durable record for
an ongoing life/work thread that can collect people, organizations, documents,
interactions, tasks, decisions, and memories.

Key columns:

- `id`
- `name`
- `status`
- `kind`
- `summary`
- `notes`
- `started_on`
- `target_date`
- `completed_on`
- `archived_at`
- `created_at`
- `updated_at`

Suggested `status` values: `active`, `waiting`, `paused`, `done`, `archived`.

Launch projects stay flat. Do not add visible subtasks or parent/child project
hierarchy before release. Project rows are manually created user structure. Imports
and extraction may link existing projects when there is a clear match, but should
surface possible new projects as suggestions rather than creating them. Store import
provenance through `sources`/`external_identities`, using `kind` values such as
`thread` or `meeting` when the upstream identifier is not a single record id.

### `tasks`

Commitments, follow-ups, reminders, and waiting items.

Key columns:

- `id`
- `title`
- `description`
- `status`
- `priority`
- `project_id`
- `due_at`
- `scheduled_for`
- `completed_at`
- `origin_document_id`
- `origin_interaction_id`
- `created_at`
- `updated_at`
- `archived_at`

Suggested `status` values: `open`, `waiting`, `scheduled`, `done`, `canceled`,
`archived`.

`project_id` is the canonical project association for launch. A task belongs to at
most one project.

### `interactions`

Human exchanges: meetings, calls, emails, messages, chats, voice notes, notes, and
events. Email bodies and meeting transcripts live here.

Granola imports should store the raw transcript in `body_text` whenever available.
AI notes, redacted digests, and agent-written summaries belong in `summary`, not as a
replacement for the transcript.

Key columns:

- `id`
- `kind`
- `title`
- `body_text`
- `summary`
- `occurred_at`
- `ended_at`
- `location`
- `external_id`
- `original_path`
- `original_url`
- `content_hash`
- `created_at`
- `updated_at`
- `archived_at`

Suggested `kind` values: `meeting`, `call`, `email`, `message`, `chat`, `voice_note`,
`note`, `event`, `other`.

### `documents`

User-readable artifacts and reference material. Imported text is stored directly in
SQLite, with optional metadata for the original file or URL.

Key columns:

- `id`
- `kind`
- `title`
- `body_text`
- `summary`
- `mime_type`
- `original_path`
- `original_url`
- `content_hash`
- `authored_at`
- `created_at`
- `updated_at`
- `archived_at`

Suggested `kind` values: `note`, `file`, `pdf`, `webpage`, `plan`, `receipt`, `text`,
`other`.

### `assets`

App-managed binary files such as avatars, organization logos, screenshots, inline
images, and original attachments. The bytes live under the chosen brain root's
`assets/` directory, following Reflect Open's ordinary-file attachment model. SQLite
stores the durable manifest and links.

Key columns:

- `id`
- `kind`
- `mime_type`
- `byte_size`
- `content_hash`
- `storage_path`
- `original_filename`
- `original_path`
- `original_url`
- `width`
- `height`
- `created_at`
- `updated_at`
- `archived_at`

Suggested `kind` values: `avatar`, `logo`, `image`, `screenshot`, `attachment`,
`source_file`, `thumbnail`, `other`.

`storage_path` is app-relative, for example `assets/pasted-20260618-ab12cd34.png` or
`assets/objects/ab/abcdef...jpg`. Absolute paths stay in provenance fields only.

### `asset_texts`

Optional durable text extracted from, or supplied with, an asset. This is the local
path for importer-provided email attachment text and safe UTF-8 text-like files. PDFs,
images, and other binary files remain searchable by metadata until a later local
extractor or OCR pass populates this table.

Key columns:

- `asset_id`
- `text`
- `text_source`
- `content_hash`
- `created_at`
- `updated_at`

Allowed `text_source` values: `importer`, `local_extraction`, `manual`.

### `sources` and `external_identities`

Provider-neutral import identity. `sources` names stable upstream systems such as
`manual`, `agent`, `gmail`, `google_people`, `google_calendar`, `google_meet`, `zoom`,
`file`, and `ai_extraction`. `external_identities` maps a source/kind/external id to a
typed Local Brain record for idempotent sync.

`sources` key columns:

- `id`
- `slug`
- `name`
- `description`
- `created_at`
- `updated_at`

`external_identities` key columns:

- `id`
- `entity_type`
- `entity_id`
- `source_id`
- `kind`
- `external_id`
- `url`
- `metadata_json`
- `created_at`
- `updated_at`

### `asset_links`

Typed links from assets to visible records.

Key columns:

- `id`
- `asset_id`
- `record_type`
- `record_id`
- `role`
- `caption`
- `sort_order`
- `created_at`

Allowed `record_type` values: `person`, `organization`, `project`, `task`, `document`,
`interaction`. Suggested `role` values: `avatar`, `logo`, `attachment`, `inline_image`,
`screenshot`, `source_file`.

### `content_chunks`

Derived chunks for lexical search, embeddings, and citations.

Key columns:

- `id`
- `record_type`
- `record_id`
- `chunk_index`
- `text`
- `token_count`
- `content_hash`
- `created_at`

Allowed `record_type` values for launch: `document`, `interaction`.

### `memories`

Hidden atomic claims extracted from documents, interactions, and tasks.

Key columns:

- `id`
- `kind`
- `claim`
- `confidence`
- `valid_from`
- `valid_to`
- `created_at`
- `updated_at`
- `archived_at`

Suggested `kind` values: `fact`, `preference`, `decision`, `commitment`,
`instruction`, `risk`, `idea`.

### `memory_links`

Generic links from hidden memories to visible records.

Key columns:

- `id`
- `memory_id`
- `record_type`
- `record_id`
- `role`
- `created_at`

Allowed `record_type` values: `person`, `organization`, `project`, `task`,
`document`, `interaction`.

### `evidence_refs`

Citation links from memories and tasks to exact document or interaction chunks.

Key columns:

- `id`
- `subject_type`
- `subject_id`
- `chunk_id`
- `quote_start`
- `quote_end`
- `note`
- `created_at`

Allowed `subject_type` values: `memory`, `task`.

### `tags` and `taggings`

Lightweight user-defined grouping.

Tags are descriptors and filters, not pseudo-projects. Use a project when the context
has lifecycle, linked people/orgs, decisions, tasks, or a useful status brief. Use tags
for cross-cutting labels such as `tax`, `receipt`, `gift`, or `medical`.

`tags` key columns:

- `id`
- `name`
- `color`
- `created_at`
- `updated_at`

`taggings` key columns:

- `id`
- `tag_id`
- `record_type`
- `record_id`
- `created_at`

Allowed `record_type` values: `person`, `organization`, `project`, `task`,
`document`, `interaction`, `memory`.

### `settings`

Local configuration.

Key columns:

- `key`
- `value_json`
- `updated_at`

Settings owns AI providers, local paths, diagnostics, and skill setup flags.

## Join Tables

Use explicit typed join tables where they make the UI faster and clearer:

- `interaction_participants`: people in an interaction plus unresolved raw handles from
  imports (`person_id` can be null when `handle` or `display_name` is preserved).
- `interaction_organizations`: organizations involved in an interaction.
- `project_people`: people linked to a project.
- `project_organizations`: organizations linked to a project.
- `project_documents`: documents linked to a project.
- `project_interactions`: interactions linked to a project.
- `document_people`: people mentioned by or related to a document.
- `document_organizations`: organizations mentioned by or related to a document.
- `document_interactions`: interactions that explain, produced, or reference a
  document.
- `task_people`: people linked to a task.
- `task_organizations`: organizations linked to a task.
- `task_documents`: documents that explain a task.
- `task_interactions`: interactions that created or changed a task.
- `asset_links`: assets attached to typed records, with role and ordering.

Each join table should include:

- `id`
- the two foreign keys
- `role`
- `created_at`

## Schema Diagram

```text
                         +----------------+
                         |    settings    |
                         +----------------+

+--------+       +---------------+       +---------------+
| people |<----->| affiliations  |<----->| organizations |
+--------+       +---------------+       +---------------+
   ^  ^                    ^                    ^   ^
   |  |                    |                    |   |
   |  +---------+----------+----------+---------+   |
   |            |                     |             |
   |       +----------+          +----------+        |
   |       | projects |<-------->|  tasks   |        |
   |       +----------+          +----------+        |
   |        ^   ^   ^              ^   ^            |
   |        |   |   |              |   |            |
   |        |   |   +--------------+   |            |
   |        |   |                      |            |
   |        |   +----------+-----------+            |
   |        |              |                        |
   v        v              v                        v
+----------------+     +----------------+     +----------+
| interactions   |<--->|   documents    |<--->|   tags   |
+----------------+     +----------------+     +----------+
        ^                     ^                    ^
        |                     |                    |
        +----------+----------+--------------------+
                   |
          +----------------+
          | content_chunks |
          +----------------+
                   ^
                   |
         +----------------+       +-------------+       +------------+
         | evidence_refs  |       | asset_links |------>|   assets   |
         +----------------+       +-------------+       +------------+
                                                       ^
                                                       |
                                                 +-------------+
                                                 | asset_texts |
                                                 +-------------+
           ^      ^
           |      |
      +---------+ |
      | memories| |
      +---------+ |
           ^      |
           |      |
      +--------------+
      | memory_links |
      +--------------+
```

## Derived Indexes

- FTS5 tables over document title/body, interaction title/body, `content_chunks.text`,
  and a derived asset projection (`assets_fts`) covering filename/title, kind, MIME
  type, storage path, original URL, link captions, linked record titles, and
  `asset_texts.text`.
- People, organizations, projects, and tasks currently use deterministic name/title
  matching for global search; they do not have dedicated FTS tables yet. Extraction
  uses project name matching only to link existing, manually created projects.
- Vector index over `content_chunks` (`chunk_embeddings` + the `chunk_vectors` vec0
  virtual table; sqlite-vec, 384-dim cosine). Derived and rebuildable; vectors are
  generated on demand by the desktop `fastembed` runtime. See `docs/reflect-embeddings/`.
- Optional denormalized search view that unions visible records for global search.
- Derived graph view centered on the `people.is_self` row, with nodes for typed records
  and edges from affiliations, join tables, task origins, memory links, evidence refs,
  asset links, and tags.

Derived indexes can be rebuilt from durable tables.

## Launch Omissions

The launch schema intentionally omits:

- A top-level ingestion bucket for raw material.
- A generic graph-node table as the primary model.
- A generic edge table as the primary link model.
- A top-level automation log table or surface.
- Row-level sensitivity labels.
- Hosted sync tables.
- Browser/email/calendar OAuth integration tables.
- User-facing subtasks or project hierarchy.

## Relationship Intelligence

Relationship intelligence is derived from typed records, especially people,
interactions, tasks, affiliations, projects, and memories.

Launch should support:

- recency through `people.last_interaction_at`
- strength through the SELECT-only `relationship_strengths` view
- important dates through `people.important_dates_json`
- prompts for Today: upcoming important dates and relationship-linked waiting items

These hints feed agents and UI. Network strength must be calculated deterministically
from durable interactions and tasks at read time, not set as third-party writable
SQLite state.
