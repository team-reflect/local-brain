# Launch Schema

This is a proposed SQLite launch schema for a consumer local brain.

The goal is not to model every part of life. The goal is to give the app and local
agents enough structure to answer useful questions with provenance.

## Design Rules

- Use SQLite as the durable source of truth.
- Use `TEXT` IDs, preferably ULIDs or UUIDv7-style sortable IDs.
- Store timestamps as ISO-8601 `TEXT`.
- Store flexible data as JSON text with validation at the application boundary.
- Keep source evidence separate from extracted memories.
- Make privacy and provenance first-class.
- Treat FTS and vectors as derived indexes.
- Make tasks first-class because day-to-day usefulness depends on them.
- Avoid separate person/org/project tables until usage proves the need.

## Core Relationship Diagram

```text
sources
  |--< source_chunks
  |       |--< embeddings
  |
  |--< memories >-- memory_entities >-- entities
  |       |                              |--< entity_aliases
  |       |                              |--< relationships >-- entities
  |       |
  |       |-- task.source_memory_id
  |       |-- event.source_memory_id
  |
  |--< tasks
  |--< events
  |--< inbox_items

agent_events -> sources / memories / entities / tasks / events
chat_conversations -> chat_messages
```

## Tables

### `sources`

Raw evidence imported by the user, an app integration, or an agent.

```sql
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  body_format TEXT NOT NULL DEFAULT 'plain_text',
  uri TEXT,
  file_path TEXT,
  external_id TEXT,
  source_app TEXT,
  source_account TEXT,
  captured_at TEXT,
  occurred_at TEXT,
  content_hash TEXT,
  language TEXT,
  privacy TEXT NOT NULL DEFAULT 'local',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind IN (
    'manual',
    'note',
    'file',
    'pdf',
    'webpage',
    'transcript',
    'email',
    'calendar_event',
    'chat',
    'audio',
    'screenshot',
    'agent'
  )),
  CHECK (privacy IN ('local', 'cloud_allowed', 'sensitive', 'never_external'))
);
```

Why it matters: sources are the audit trail. If a memory cannot point to evidence, the
UI should treat it as weaker.

### `source_chunks`

Searchable and embeddable pieces of a source.

```sql
CREATE TABLE source_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  char_start INTEGER,
  char_end INTEGER,
  token_count INTEGER,
  content_hash TEXT NOT NULL,
  privacy TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_id, chunk_index)
);
```

### `entities`

The nouns in the user's life.

```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  summary TEXT,
  importance INTEGER NOT NULL DEFAULT 0,
  privacy TEXT NOT NULL DEFAULT 'local',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (type IN (
    'person',
    'organization',
    'project',
    'place',
    'topic',
    'product',
    'account',
    'file',
    'event',
    'other'
  ))
);

CREATE UNIQUE INDEX entities_type_canonical_key
  ON entities(type, canonical_key)
  WHERE archived_at IS NULL;
```

Do not launch with separate `people`, `organizations`, and `projects` tables. Use
generic entities first, then add typed profile tables once the product shows which
fields matter.

### `entity_aliases`

Alternate names used for matching and display.

```sql
CREATE TABLE entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (entity_id, alias_key)
);
```

### `memories`

Atomic beliefs extracted from sources or written manually.

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  title TEXT,
  body TEXT NOT NULL,
  value_json TEXT,
  status TEXT NOT NULL DEFAULT 'suggested',
  confidence REAL,
  importance INTEGER NOT NULL DEFAULT 0,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  source_chunk_id TEXT REFERENCES source_chunks(id) ON DELETE SET NULL,
  source_excerpt TEXT,
  observed_at TEXT,
  valid_from TEXT,
  valid_until TEXT,
  forgotten_at TEXT,
  privacy TEXT NOT NULL DEFAULT 'local',
  created_by TEXT NOT NULL DEFAULT 'user',
  created_by_agent TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind IN (
    'fact',
    'preference',
    'decision',
    'commitment',
    'summary',
    'reminder',
    'question',
    'risk',
    'idea',
    'instruction',
    'other'
  )),
  CHECK (status IN ('suggested', 'confirmed', 'rejected', 'stale', 'archived')),
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);
```

This is the heart of the system. A good memory is small, cited, typed, time-aware, and
reviewable.

### `memory_entities`

Many-to-many links between memories and entities.

```sql
CREATE TABLE memory_entities (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'mentioned',
  created_at TEXT NOT NULL,
  PRIMARY KEY (memory_id, entity_id, role)
);
```

Suggested roles: `subject`, `mentioned`, `owner`, `participant`, `location`, `related`.

### `relationships`

Typed edges between entities.

```sql
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT,
  strength REAL,
  status TEXT NOT NULL DEFAULT 'active',
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  source_memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  observed_at TEXT,
  valid_from TEXT,
  valid_until TEXT,
  privacy TEXT NOT NULL DEFAULT 'local',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (source_entity_id <> target_entity_id),
  CHECK (status IN ('suggested', 'active', 'inactive', 'rejected', 'archived'))
);
```

Examples: `works_with`, `friend_of`, `member_of`, `reports_to`, `owns`, `uses`,
`lives_in`, `introduced_by`, `related_to`.

### `tasks`

Operational commitments and to-dos, manual or extracted.

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  priority INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  scheduled_for TEXT,
  completed_at TEXT,
  canceled_at TEXT,
  project_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  assignee_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  source_memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL DEFAULT 'user',
  created_by_agent TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('open', 'waiting', 'scheduled', 'done', 'canceled', 'archived')),
  CHECK (priority >= 0 AND priority <= 4)
);
```

### `events`

Meetings, calls, trips, deadlines, personal events, and important dates.

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'event',
  description TEXT,
  starts_at TEXT,
  ends_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  location_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  source_memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  privacy TEXT NOT NULL DEFAULT 'local',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### `event_entities`

Participants and related entities for events.

```sql
CREATE TABLE event_entities (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'participant',
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, entity_id, role)
);
```

### `inbox_items`

Human review queue for uncertain or important changes.

```sql
CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  target_type TEXT,
  target_id TEXT,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  agent_event_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK (kind IN (
    'memory_suggestion',
    'entity_merge',
    'task_suggestion',
    'relationship_suggestion',
    'privacy_review',
    'import_issue',
    'question'
  )),
  CHECK (status IN ('open', 'accepted', 'rejected', 'snoozed', 'resolved'))
);
```

### `agent_events`

Audit trail for local agents and importers.

```sql
CREATE TABLE agent_events (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT,
  target_type TEXT,
  target_id TEXT,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ok',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (status IN ('ok', 'error', 'canceled'))
);
```

### `chat_conversations` and `chat_messages`

Durable AI chat history.

```sql
CREATE TABLE chat_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, seq)
);
```

### `embeddings`

Derived vectors for retrieval.

```sql
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  chunk_id TEXT,
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

The vector payload itself may live in a `sqlite-vec` virtual table keyed by this row ID.

### `settings`

Non-secret local settings.

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Secrets belong in the OS keychain, not in SQLite.

## Search Tables

Use FTS5 virtual tables for lexical search:

```sql
CREATE VIRTUAL TABLE source_chunks_fts
USING fts5(source_id UNINDEXED, chunk_id UNINDEXED, title, body);

CREATE VIRTUAL TABLE memories_fts
USING fts5(memory_id UNINDEXED, title, body, source_excerpt);

CREATE VIRTUAL TABLE entities_fts
USING fts5(entity_id UNINDEXED, name, summary, aliases);

CREATE VIRTUAL TABLE tasks_fts
USING fts5(task_id UNINDEXED, title, notes);
```

These should be derived and rebuildable.

## Important Indexes

```sql
CREATE INDEX sources_kind_occurred ON sources(kind, occurred_at);
CREATE INDEX source_chunks_source ON source_chunks(source_id, chunk_index);
CREATE INDEX memories_status_kind ON memories(status, kind);
CREATE INDEX memories_subject ON memories(subject_entity_id);
CREATE INDEX memories_observed ON memories(observed_at);
CREATE INDEX memory_entities_entity ON memory_entities(entity_id);
CREATE INDEX relationships_source ON relationships(source_entity_id);
CREATE INDEX relationships_target ON relationships(target_entity_id);
CREATE INDEX tasks_status_due ON tasks(status, due_at);
CREATE INDEX events_starts ON events(starts_at);
CREATE INDEX inbox_items_status_created ON inbox_items(status, created_at);
CREATE INDEX agent_events_agent_created ON agent_events(agent_name, created_at);
```

## Day-to-Day Query Examples

### Today's useful context

```text
open tasks due today
+ upcoming events
+ recent confirmed memories
+ open inbox suggestions
+ people/projects mentioned in the last few days
```

### What did I promise Sarah?

```text
find entity alias "Sarah"
-> memories where kind = commitment and linked to Sarah
-> tasks linked to Sarah
-> sources/chunks citing those commitments
```

### What is this project about?

```text
entity project page
-> summary memories
-> open tasks
-> recent events
-> related people/orgs
-> source timeline
```

### What can my agent safely know?

```text
retrieval filter excludes privacy = never_external
cloud model filter excludes sensitive unless user approves
local-only model can use more context
answer records context_json in chat_messages
```

## Tables to Delay

Do not add these until the product proves the need:

- Separate `people` profiles.
- Separate `organizations` profiles.
- Separate `projects` profiles.
- Full email/calendar/browser integration tables.
- Complex sync tables.
- Collaboration/multi-user access control.
- A generic table-editor metadata layer.

The launch schema should be compact enough that local agents can use it without fear.
