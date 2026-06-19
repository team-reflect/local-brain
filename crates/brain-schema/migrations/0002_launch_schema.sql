-- Local Brain launch schema (see docs/launch-schema.md).
--
-- A personal CRM with first-class people, organizations, projects, tasks,
-- interactions, documents, hidden atomic memories, tags, and settings.
-- SQLite is the durable source of truth; only content_chunks and the FTS tables
-- are derived and rebuildable.
--
-- Conventions:
--   * Ids are app-generated ULIDs stored as TEXT primary keys.
--   * Timestamps are ISO-8601 TEXT (UTC); created_at/updated_at default to now.
--   * Dates (*_on) are 'YYYY-MM-DD' TEXT.
--   * Booleans are INTEGER 0/1.
--   * Polymorphic record_type/subject_type columns carry a CHECK of the allowed
--     values and a composite index; they cannot use SQL foreign keys.

----------------------------------------------------------------------
-- settings
----------------------------------------------------------------------
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

----------------------------------------------------------------------
-- organizations
----------------------------------------------------------------------
CREATE TABLE organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT,
  domain      TEXT,
  location    TEXT,
  summary     TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
);

----------------------------------------------------------------------
-- people  (the user is the row with is_self = 1)
----------------------------------------------------------------------
CREATE TABLE people (
  id                      TEXT PRIMARY KEY,
  full_name               TEXT NOT NULL,
  preferred_name          TEXT,
  headline                TEXT,
  primary_email           TEXT,
  primary_phone           TEXT,
  location                TEXT,
  is_self                 INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0, 1)),
  relationship_strength   INTEGER,
  reconnect_interval_days INTEGER,
  last_interaction_at     TEXT,
  next_reconnect_at       TEXT,
  important_dates_json    TEXT,
  summary                 TEXT,
  notes                   TEXT,
  current_organization_id TEXT REFERENCES organizations (id) ON DELETE SET NULL,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at             TEXT
);

----------------------------------------------------------------------
-- affiliations  (time-bound person <-> organization links)
----------------------------------------------------------------------
CREATE TABLE affiliations (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title           TEXT,
  role            TEXT,
  started_on      TEXT,
  ended_on        TEXT,
  is_current      INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

----------------------------------------------------------------------
-- projects
----------------------------------------------------------------------
CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  kind         TEXT,
  summary      TEXT,
  notes        TEXT,
  started_on   TEXT,
  target_date  TEXT,
  completed_on TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at  TEXT
);

----------------------------------------------------------------------
-- documents  (readable text stored directly; provenance on the record)
----------------------------------------------------------------------
CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  kind          TEXT,
  title         TEXT,
  body_text     TEXT,
  summary       TEXT,
  mime_type     TEXT,
  original_path TEXT,
  original_url  TEXT,
  content_hash  TEXT,
  authored_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at   TEXT
);

----------------------------------------------------------------------
-- interactions  (meetings, calls, emails, messages, notes, events)
----------------------------------------------------------------------
CREATE TABLE interactions (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'note',
  title         TEXT,
  body_text     TEXT,
  summary       TEXT,
  occurred_at   TEXT,
  ended_at      TEXT,
  location      TEXT,
  external_id   TEXT,
  original_path TEXT,
  original_url  TEXT,
  content_hash  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at   TEXT
);

----------------------------------------------------------------------
-- tasks  (commitments, follow-ups, reminders, waiting items)
----------------------------------------------------------------------
CREATE TABLE tasks (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  description          TEXT,
  status               TEXT NOT NULL DEFAULT 'open',
  priority             INTEGER,
  project_id           TEXT REFERENCES projects (id) ON DELETE SET NULL,
  due_at               TEXT,
  scheduled_for        TEXT,
  completed_at         TEXT,
  origin_document_id   TEXT REFERENCES documents (id) ON DELETE SET NULL,
  origin_interaction_id TEXT REFERENCES interactions (id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at          TEXT
);

----------------------------------------------------------------------
-- content_chunks  (derived from documents and interactions)
----------------------------------------------------------------------
CREATE TABLE content_chunks (
  id           TEXT PRIMARY KEY,
  record_type  TEXT NOT NULL CHECK (record_type IN ('document', 'interaction')),
  record_id    TEXT NOT NULL,
  chunk_index  INTEGER NOT NULL,
  text         TEXT NOT NULL,
  token_count  INTEGER,
  content_hash TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

----------------------------------------------------------------------
-- memories  (hidden atomic claims)
----------------------------------------------------------------------
CREATE TABLE memories (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'fact',
  claim       TEXT NOT NULL,
  confidence  REAL,
  valid_from  TEXT,
  valid_to    TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
);

----------------------------------------------------------------------
-- memory_links  (memory -> visible record)
----------------------------------------------------------------------
CREATE TABLE memory_links (
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
  record_type TEXT NOT NULL CHECK (
    record_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction')
  ),
  record_id   TEXT NOT NULL,
  role        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

----------------------------------------------------------------------
-- evidence_refs  (memory/task -> exact chunk)
----------------------------------------------------------------------
CREATE TABLE evidence_refs (
  id           TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('memory', 'task')),
  subject_id   TEXT NOT NULL,
  chunk_id     TEXT NOT NULL REFERENCES content_chunks (id) ON DELETE CASCADE,
  quote_start  INTEGER,
  quote_end    INTEGER,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

----------------------------------------------------------------------
-- tags + taggings
----------------------------------------------------------------------
CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE taggings (
  id          TEXT PRIMARY KEY,
  tag_id      TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  record_type TEXT NOT NULL CHECK (
    record_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction', 'memory')
  ),
  record_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tag_id, record_type, record_id)
);

----------------------------------------------------------------------
-- Typed join tables. Each: id, two FKs (ON DELETE CASCADE), role, created_at,
-- and a uniqueness guard on the pair.
----------------------------------------------------------------------
CREATE TABLE interaction_participants (
  id             TEXT PRIMARY KEY,
  interaction_id TEXT NOT NULL REFERENCES interactions (id) ON DELETE CASCADE,
  person_id      TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  role           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (interaction_id, person_id)
);

CREATE TABLE interaction_organizations (
  id              TEXT PRIMARY KEY,
  interaction_id  TEXT NOT NULL REFERENCES interactions (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (interaction_id, organization_id)
);

CREATE TABLE interaction_projects (
  id             TEXT PRIMARY KEY,
  interaction_id TEXT NOT NULL REFERENCES interactions (id) ON DELETE CASCADE,
  project_id     TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  role           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (interaction_id, project_id)
);

CREATE TABLE project_people (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  person_id  TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  role       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, person_id)
);

CREATE TABLE project_organizations (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, organization_id)
);

CREATE TABLE project_documents (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  role        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, document_id)
);

CREATE TABLE project_interactions (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  interaction_id TEXT NOT NULL REFERENCES interactions (id) ON DELETE CASCADE,
  role           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, interaction_id)
);

CREATE TABLE project_tasks (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  task_id    TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  role       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, task_id)
);

CREATE TABLE document_people (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  role        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (document_id, person_id)
);

CREATE TABLE document_organizations (
  id              TEXT PRIMARY KEY,
  document_id     TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (document_id, organization_id)
);

CREATE TABLE document_projects (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  role        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (document_id, project_id)
);

CREATE TABLE document_interactions (
  id             TEXT PRIMARY KEY,
  document_id    TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  interaction_id TEXT NOT NULL REFERENCES interactions (id) ON DELETE CASCADE,
  role           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (document_id, interaction_id)
);

CREATE TABLE task_people (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  person_id  TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  role       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (task_id, person_id)
);

CREATE TABLE task_organizations (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (task_id, organization_id)
);

CREATE TABLE task_documents (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  role        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (task_id, document_id)
);

CREATE TABLE task_interactions (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  interaction_id TEXT NOT NULL REFERENCES interactions (id) ON DELETE CASCADE,
  role           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (task_id, interaction_id)
);

----------------------------------------------------------------------
-- Indexes for common filters (Plan 02 step 3).
----------------------------------------------------------------------
-- At most one self person row.
CREATE UNIQUE INDEX idx_people_self ON people (is_self) WHERE is_self = 1;
CREATE INDEX idx_people_full_name ON people (full_name);
CREATE INDEX idx_people_next_reconnect ON people (next_reconnect_at) WHERE archived_at IS NULL;
CREATE INDEX idx_people_last_interaction ON people (last_interaction_at) WHERE archived_at IS NULL;
CREATE INDEX idx_people_current_org ON people (current_organization_id);

CREATE INDEX idx_organizations_name ON organizations (name);

CREATE INDEX idx_affiliations_person ON affiliations (person_id);
CREATE INDEX idx_affiliations_organization ON affiliations (organization_id);

CREATE INDEX idx_projects_status ON projects (status);

-- Active tasks by due date + status.
CREATE INDEX idx_tasks_status_due ON tasks (status, due_at) WHERE archived_at IS NULL;
CREATE INDEX idx_tasks_project ON tasks (project_id);
CREATE INDEX idx_tasks_scheduled ON tasks (scheduled_for) WHERE archived_at IS NULL;

CREATE INDEX idx_interactions_occurred ON interactions (occurred_at);
CREATE INDEX idx_interactions_content_hash ON interactions (content_hash);

CREATE INDEX idx_documents_authored ON documents (authored_at);
CREATE INDEX idx_documents_created ON documents (created_at);
CREATE INDEX idx_documents_content_hash ON documents (content_hash);

CREATE INDEX idx_content_chunks_record ON content_chunks (record_type, record_id);

CREATE INDEX idx_memory_links_memory ON memory_links (memory_id);
CREATE INDEX idx_memory_links_record ON memory_links (record_type, record_id);

CREATE INDEX idx_evidence_subject ON evidence_refs (subject_type, subject_id);
CREATE INDEX idx_evidence_chunk ON evidence_refs (chunk_id);

CREATE INDEX idx_taggings_tag ON taggings (tag_id);
CREATE INDEX idx_taggings_record ON taggings (record_type, record_id);

----------------------------------------------------------------------
-- FTS5 over document/interaction text and derived chunks (Plan 02 step 4).
-- External-content tables keyed to each base table's rowid, kept in sync by
-- triggers. Name/title search for people/orgs/projects/tasks is layered on in
-- Plan 06 (search ranking). FTS is derived and rebuildable.
----------------------------------------------------------------------
CREATE VIRTUAL TABLE documents_fts USING fts5 (
  title,
  body_text,
  content = 'documents',
  content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts (rowid, title, body_text)
  VALUES (new.rowid, new.title, new.body_text);
END;

CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts (documents_fts, rowid, title, body_text)
  VALUES ('delete', old.rowid, old.title, old.body_text);
END;

CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts (documents_fts, rowid, title, body_text)
  VALUES ('delete', old.rowid, old.title, old.body_text);
  INSERT INTO documents_fts (rowid, title, body_text)
  VALUES (new.rowid, new.title, new.body_text);
END;

CREATE VIRTUAL TABLE interactions_fts USING fts5 (
  title,
  body_text,
  content = 'interactions',
  content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER interactions_ai AFTER INSERT ON interactions BEGIN
  INSERT INTO interactions_fts (rowid, title, body_text)
  VALUES (new.rowid, new.title, new.body_text);
END;

CREATE TRIGGER interactions_ad AFTER DELETE ON interactions BEGIN
  INSERT INTO interactions_fts (interactions_fts, rowid, title, body_text)
  VALUES ('delete', old.rowid, old.title, old.body_text);
END;

CREATE TRIGGER interactions_au AFTER UPDATE ON interactions BEGIN
  INSERT INTO interactions_fts (interactions_fts, rowid, title, body_text)
  VALUES ('delete', old.rowid, old.title, old.body_text);
  INSERT INTO interactions_fts (rowid, title, body_text)
  VALUES (new.rowid, new.title, new.body_text);
END;

CREATE VIRTUAL TABLE content_chunks_fts USING fts5 (
  text,
  content = 'content_chunks',
  content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER content_chunks_ai AFTER INSERT ON content_chunks BEGIN
  INSERT INTO content_chunks_fts (rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER content_chunks_ad AFTER DELETE ON content_chunks BEGIN
  INSERT INTO content_chunks_fts (content_chunks_fts, rowid, text)
  VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER content_chunks_au AFTER UPDATE ON content_chunks BEGIN
  INSERT INTO content_chunks_fts (content_chunks_fts, rowid, text)
  VALUES ('delete', old.rowid, old.text);
  INSERT INTO content_chunks_fts (rowid, text) VALUES (new.rowid, new.text);
END;
