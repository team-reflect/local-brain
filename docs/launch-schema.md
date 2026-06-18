# Launch Schema

SQLite is the durable source of truth for Local Brain. The launch schema is a personal
CRM with first-class people, organizations, projects, tasks, interactions, documents,
hidden atomic memories, tags, AI chat, and settings.

The schema should make everyday questions easy:

- Who did I talk to, and what did we decide?
- What am I waiting on?
- What projects are active?
- What documents and conversations explain this?
- What does my AI know, and what evidence supports it?

## Schema Principles

- Use typed tables for product nouns instead of a generic graph-node layer.
- Store imported readable text directly in SQLite.
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
- `relationship_strength`
- `reconnect_interval_days`
- `last_interaction_at`
- `next_reconnect_at`
- `important_dates_json`
- `summary`
- `notes`
- `current_organization_id`
- `created_at`
- `updated_at`
- `archived_at`

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

Personal or professional work areas.

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

### `interactions`

Human exchanges: meetings, calls, emails, messages, chats, voice notes, notes, and
events. Email bodies and meeting transcripts live here.

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

Hidden atomic claims extracted from documents, interactions, tasks, and chat.

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

Citation links from memories, tasks, and AI answers to exact document or interaction
chunks.

Key columns:

- `id`
- `subject_type`
- `subject_id`
- `chunk_id`
- `quote_start`
- `quote_end`
- `note`
- `created_at`

Allowed `subject_type` values: `memory`, `task`, `chat_message`.

### `tags` and `taggings`

Lightweight user-defined grouping.

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

### `chat_conversations` and `chat_messages`

Ask conversations and answer history.

`chat_conversations` key columns:

- `id`
- `title`
- `created_at`
- `updated_at`
- `archived_at`

`chat_messages` key columns:

- `id`
- `conversation_id`
- `role`
- `content`
- `model`
- `created_at`

Assistant messages can be cited through `evidence_refs`.

### `settings`

Local configuration.

Key columns:

- `key`
- `value_json`
- `updated_at`

Settings owns AI providers, local paths, diagnostics, and skill setup flags.

## Join Tables

Use explicit typed join tables where they make the UI faster and clearer:

- `interaction_participants`: people in an interaction.
- `interaction_organizations`: organizations involved in an interaction.
- `interaction_projects`: projects discussed in an interaction.
- `project_people`: people linked to a project.
- `project_organizations`: organizations linked to a project.
- `project_documents`: documents linked to a project.
- `project_interactions`: interactions linked to a project.
- `project_tasks`: tasks linked to a project when the task's direct `project_id` is
  not enough for cross-project work.
- `document_people`: people mentioned by or related to a document.
- `document_organizations`: organizations mentioned by or related to a document.
- `document_projects`: projects related to a document.
- `document_interactions`: interactions that explain, produced, or reference a
  document.
- `task_people`: people linked to a task.
- `task_organizations`: organizations linked to a task.
- `task_documents`: documents that explain a task.
- `task_interactions`: interactions that created or changed a task.

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
          +----------------+
          | evidence_refs  |
          +----------------+
            ^      ^     ^
            |      |     |
       +---------+ | +--------------------+
       | memories| | |  chat_messages     |
       +---------+ | +--------------------+
            ^      |          ^
            |      |          |
       +--------------+ +--------------------+
       | memory_links | | chat_conversations |
       +--------------+ +--------------------+
```

## Derived Indexes

- FTS5 tables over `documents.body_text`, `interactions.body_text`,
  `content_chunks.text`, task titles/descriptions, people names, organization names,
  and project names.
- Vector index over `content_chunks` (`chunk_embeddings` + the `chunk_vectors` vec0
  virtual table; sqlite-vec, 384-dim cosine). Derived and rebuildable; vectors are
  generated on demand by the desktop `fastembed` runtime. See `docs/reflect-embeddings/`.
- Optional denormalized search view that unions visible records for global search.
- Derived graph view centered on the `people.is_self` row, with nodes for typed records
  and edges from affiliations, join tables, task origins, memory links, evidence refs,
  and tags.

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

## Relationship Intelligence

Relationship intelligence is derived from typed records, especially people,
interactions, tasks, affiliations, projects, and memories.

Launch should support:

- recency through `people.last_interaction_at`
- cadence through `people.reconnect_interval_days` and `people.next_reconnect_at`
- strength through `people.relationship_strength`
- important dates through `people.important_dates_json`
- prompts for Today: people to follow up with, stale relationships, upcoming important
  dates, and relationship-linked waiting items

These fields are hints for agents and UI. They should be recomputable from durable
interactions and tasks where possible.
