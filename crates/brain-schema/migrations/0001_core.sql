-- Local Brain ground-up core schema.
--
-- SQLite is the durable source of truth. Product tables are durable; FTS and
-- vector projections are created in 0002_search.sql and may be rebuilt.

CREATE TABLE schema_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO schema_meta (key, value) VALUES ('app', 'local-brain');

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sources (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT,
  domain      TEXT,
  headline    TEXT,
  summary     TEXT,
  website     TEXT,
  industry    TEXT,
  location    TEXT,
  hq_city     TEXT,
  hq_region   TEXT,
  hq_country  TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
);

CREATE TABLE people (
  id                      TEXT PRIMARY KEY,
  full_name               TEXT NOT NULL,
  preferred_name          TEXT,
  headline                TEXT,
  summary                 TEXT,
  primary_email           TEXT,
  primary_phone           TEXT,
  location                TEXT,
  city                    TEXT,
  region                  TEXT,
  country                 TEXT,
  timezone                TEXT,
  linkedin_url            TEXT,
  website                 TEXT,
  important_dates_json    TEXT,
  notes                   TEXT,
  is_self                 INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0, 1)),
  current_title           TEXT,
  current_department      TEXT,
  current_organization_id TEXT REFERENCES organizations (id) ON DELETE SET NULL,
  role_family             TEXT,
  seniority               TEXT,
  last_interaction_at     TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at             TEXT
);

CREATE TABLE person_emails (
  id               TEXT PRIMARY KEY,
  person_id        TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  label            TEXT,
  is_primary       INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  source_id        TEXT REFERENCES sources (id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (person_id, normalized_email)
);

CREATE TABLE person_phones (
  id               TEXT PRIMARY KEY,
  person_id        TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  phone            TEXT NOT NULL,
  normalized_phone TEXT NOT NULL,
  label            TEXT,
  is_primary       INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  source_id        TEXT REFERENCES sources (id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (person_id, normalized_phone)
);

CREATE TABLE affiliations (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title           TEXT,
  department      TEXT,
  role            TEXT,
  role_family     TEXT,
  seniority       TEXT,
  started_on      TEXT,
  ended_on        TEXT,
  is_current      INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  is_primary      INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  evidence_ref_id TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (person_id, organization_id, title)
);

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
  occurred_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at   TEXT
);

CREATE TABLE interactions (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'note',
  title         TEXT,
  body_text     TEXT,
  summary       TEXT,
  occurred_at   TEXT,
  ended_at      TEXT,
  duration_seconds INTEGER,
  location      TEXT,
  external_id   TEXT,
  original_path TEXT,
  original_url  TEXT,
  content_hash  TEXT,
  metadata_json TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at   TEXT
);

CREATE TABLE interaction_transcripts (
  id                 TEXT PRIMARY KEY,
  interaction_id     TEXT NOT NULL REFERENCES interactions (id) ON DELETE CASCADE,
  raw_text           TEXT NOT NULL,
  format             TEXT NOT NULL DEFAULT 'plain_text',
  language           TEXT,
  segments_json      TEXT,
  recording_url      TEXT,
  storage_path       TEXT,
  source_id          TEXT REFERENCES sources (id) ON DELETE SET NULL,
  source_external_id TEXT,
  transcribed_by     TEXT,
  transcribed_at     TEXT,
  content_hash       TEXT,
  metadata_json      TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (interaction_id),
  UNIQUE (source_id, source_external_id)
);

CREATE TABLE organization_profiles (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  model                TEXT,
  prompt_fingerprint   TEXT,
  canonical_name       TEXT,
  website              TEXT,
  one_line_description TEXT,
  category             TEXT,
  why_it_matters       TEXT,
  offerings_json       TEXT,
  notable_people_json  TEXT,
  suggested_tags_json  TEXT,
  review_flags_json    TEXT,
  source_urls_json     TEXT,
  raw_enrichment_json  TEXT,
  researched_at        TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (organization_id, prompt_fingerprint)
);

CREATE TABLE tasks (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  description           TEXT,
  status                TEXT NOT NULL DEFAULT 'open',
  priority              INTEGER,
  project_id            TEXT REFERENCES projects (id) ON DELETE SET NULL,
  due_at                TEXT,
  scheduled_for         TEXT,
  completed_at          TEXT,
  origin_document_id    TEXT REFERENCES documents (id) ON DELETE SET NULL,
  origin_interaction_id TEXT REFERENCES interactions (id) ON DELETE SET NULL,
  source_record_type    TEXT,
  source_record_id      TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at           TEXT
);

CREATE TABLE ai_notes (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL DEFAULT 'summary',
  interaction_id     TEXT REFERENCES interactions (id) ON DELETE CASCADE,
  document_id        TEXT REFERENCES documents (id) ON DELETE CASCADE,
  subject_type       TEXT,
  subject_id         TEXT,
  title              TEXT,
  content            TEXT NOT NULL,
  content_format     TEXT NOT NULL DEFAULT 'markdown',
  model              TEXT,
  prompt_fingerprint TEXT,
  source_id          TEXT REFERENCES sources (id) ON DELETE SET NULL,
  metadata_json      TEXT,
  generated_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (interaction_id IS NOT NULL) +
    (document_id IS NOT NULL) +
    (subject_type IS NOT NULL AND subject_id IS NOT NULL) = 1
  )
);

CREATE TABLE extracted_facts (
  id                 TEXT PRIMARY KEY,
  subject_type       TEXT NOT NULL,
  subject_id         TEXT NOT NULL,
  key                TEXT NOT NULL,
  value_text         TEXT,
  value_json         TEXT,
  confidence         REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  source_record_type TEXT,
  source_record_id   TEXT,
  source_excerpt     TEXT,
  observed_at        TEXT,
  model              TEXT,
  prompt_fingerprint TEXT,
  metadata_json      TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at        TEXT,
  CHECK (value_text IS NOT NULL OR value_json IS NOT NULL)
);

CREATE TABLE memories (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'fact',
  claim       TEXT NOT NULL,
  confidence  REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  valid_from  TEXT,
  valid_to    TEXT,
  promoted_from_fact_id TEXT REFERENCES extracted_facts (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
);

CREATE TABLE content_chunks (
  id            TEXT PRIMARY KEY,
  record_type   TEXT NOT NULL CHECK (
    record_type IN (
      'person', 'organization', 'organization_profile', 'project', 'task',
      'document', 'interaction', 'interaction_transcript', 'ai_note',
      'extracted_fact', 'memory', 'asset'
    )
  ),
  record_id     TEXT NOT NULL,
  source_record_type TEXT,
  source_record_id   TEXT,
  chunk_index   INTEGER NOT NULL,
  text          TEXT NOT NULL,
  token_count   INTEGER,
  content_hash  TEXT,
  citation_label TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (record_type, record_id, chunk_index)
);

CREATE TABLE evidence_refs (
  id            TEXT PRIMARY KEY,
  subject_type  TEXT NOT NULL CHECK (
    subject_type IN (
      'memory', 'task', 'extracted_fact', 'ai_note', 'organization_profile',
      'person', 'organization', 'project', 'document', 'interaction',
      'interaction_transcript'
    )
  ),
  subject_id    TEXT NOT NULL,
  chunk_id      TEXT NOT NULL REFERENCES content_chunks (id) ON DELETE CASCADE,
  quote_start   INTEGER,
  quote_end     INTEGER,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE memory_links (
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
  record_type TEXT NOT NULL CHECK (
    record_type IN (
      'person', 'organization', 'organization_profile', 'project', 'task',
      'document', 'interaction', 'interaction_transcript', 'ai_note',
      'extracted_fact', 'asset'
    )
  ),
  record_id   TEXT NOT NULL,
  role        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT UNIQUE,
  color       TEXT,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE taggings (
  id          TEXT PRIMARY KEY,
  tag_id      TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  record_type TEXT NOT NULL CHECK (
    record_type IN (
      'person', 'organization', 'organization_profile', 'project', 'task',
      'document', 'interaction', 'interaction_transcript', 'ai_note',
      'extracted_fact', 'memory', 'asset'
    )
  ),
  record_id   TEXT NOT NULL,
  source_id   TEXT REFERENCES sources (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tag_id, record_type, record_id)
);

CREATE TABLE assets (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL DEFAULT 'attachment',
  mime_type         TEXT,
  byte_size         INTEGER NOT NULL,
  content_hash      TEXT NOT NULL,
  storage_path      TEXT NOT NULL UNIQUE,
  original_filename TEXT,
  original_path     TEXT,
  original_url      TEXT,
  width             INTEGER,
  height            INTEGER,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at       TEXT
);

CREATE TABLE asset_links (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  record_type TEXT NOT NULL CHECK (
    record_type IN (
      'person', 'organization', 'project', 'task', 'document', 'interaction',
      'interaction_transcript', 'ai_note', 'extracted_fact'
    )
  ),
  record_id   TEXT NOT NULL,
  role        TEXT,
  caption     TEXT,
  sort_order  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (asset_id, record_type, record_id, role)
);

CREATE TABLE asset_texts (
  asset_id     TEXT PRIMARY KEY REFERENCES assets (id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  text_source  TEXT NOT NULL DEFAULT 'manual',
  content_hash TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (trim(text) != ''),
  CHECK (text_source IN ('importer', 'local_extraction', 'manual'))
);

CREATE TABLE external_identities (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN (
      'person', 'organization', 'organization_profile', 'project', 'task',
      'document', 'interaction', 'interaction_transcript', 'ai_note',
      'extracted_fact', 'memory', 'asset'
    )
  ),
  entity_id   TEXT NOT NULL,
  source_id   TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'record',
  external_id TEXT NOT NULL,
  url         TEXT,
  metadata_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source_id, kind, external_id)
);

CREATE TABLE record_provenance (
  id                   TEXT PRIMARY KEY,
  record_type          TEXT NOT NULL,
  record_id            TEXT NOT NULL,
  provenance_kind      TEXT NOT NULL DEFAULT 'imported',
  source_id            TEXT REFERENCES sources (id) ON DELETE SET NULL,
  external_identity_id TEXT REFERENCES external_identities (id) ON DELETE SET NULL,
  original_path        TEXT,
  original_url         TEXT,
  imported_at          TEXT,
  model                TEXT,
  prompt_fingerprint   TEXT,
  metadata_json        TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE interaction_participants (
  id                TEXT PRIMARY KEY,
  interaction_id    TEXT NOT NULL REFERENCES interactions (id) ON DELETE CASCADE,
  person_id         TEXT REFERENCES people (id) ON DELETE CASCADE,
  role              TEXT,
  handle            TEXT,
  normalized_handle TEXT,
  display_name      TEXT,
  source_id         TEXT REFERENCES sources (id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (person_id IS NOT NULL OR normalized_handle IS NOT NULL OR display_name IS NOT NULL)
);

CREATE TABLE interaction_organizations (
  id              TEXT PRIMARY KEY,
  interaction_id  TEXT NOT NULL REFERENCES interactions (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (interaction_id, organization_id)
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

CREATE TABLE chat_conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
);

CREATE TABLE chat_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content_text    TEXT NOT NULL DEFAULT '',
  ui_message_json TEXT NOT NULL,
  model           TEXT,
  status          TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('submitted', 'streaming', 'done', 'error')),
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX idx_people_self ON people (is_self) WHERE is_self = 1;
CREATE INDEX idx_people_full_name ON people (full_name);
CREATE INDEX idx_people_current_org ON people (current_organization_id);
CREATE INDEX idx_person_emails_normalized ON person_emails (normalized_email);
CREATE INDEX idx_person_phones_normalized ON person_phones (normalized_phone);
CREATE INDEX idx_organizations_name ON organizations (name);
CREATE INDEX idx_organizations_domain ON organizations (domain) WHERE domain IS NOT NULL;
CREATE INDEX idx_affiliations_person ON affiliations (person_id);
CREATE INDEX idx_affiliations_organization ON affiliations (organization_id);
CREATE UNIQUE INDEX idx_affiliations_one_current ON affiliations (person_id) WHERE is_current = 1;
CREATE UNIQUE INDEX idx_affiliations_one_primary ON affiliations (person_id) WHERE is_primary = 1;
CREATE INDEX idx_projects_status ON projects (status);
CREATE INDEX idx_tasks_status_due ON tasks (status, due_at) WHERE archived_at IS NULL;
CREATE INDEX idx_tasks_project ON tasks (project_id);
CREATE INDEX idx_tasks_scheduled ON tasks (scheduled_for) WHERE archived_at IS NULL;
CREATE INDEX idx_documents_content_hash ON documents (content_hash);
CREATE INDEX idx_documents_authored ON documents (authored_at);
CREATE INDEX idx_interactions_occurred ON interactions (occurred_at);
CREATE INDEX idx_interactions_content_hash ON interactions (content_hash);
CREATE UNIQUE INDEX idx_interaction_participants_person
  ON interaction_participants (interaction_id, person_id)
  WHERE person_id IS NOT NULL;
CREATE UNIQUE INDEX idx_interaction_participants_handle_role
  ON interaction_participants (interaction_id, normalized_handle, COALESCE(role, ''))
  WHERE normalized_handle IS NOT NULL;
CREATE INDEX idx_interaction_transcripts_interaction ON interaction_transcripts (interaction_id);
CREATE INDEX idx_organization_profiles_org ON organization_profiles (organization_id);
CREATE INDEX idx_ai_notes_interaction ON ai_notes (interaction_id);
CREATE INDEX idx_ai_notes_document ON ai_notes (document_id);
CREATE INDEX idx_ai_notes_subject ON ai_notes (subject_type, subject_id);
CREATE INDEX idx_extracted_facts_subject ON extracted_facts (subject_type, subject_id, key);
CREATE INDEX idx_content_chunks_record ON content_chunks (record_type, record_id);
CREATE INDEX idx_evidence_subject ON evidence_refs (subject_type, subject_id);
CREATE INDEX idx_evidence_chunk ON evidence_refs (chunk_id);
CREATE INDEX idx_memory_links_memory ON memory_links (memory_id);
CREATE INDEX idx_memory_links_record ON memory_links (record_type, record_id);
CREATE INDEX idx_taggings_tag ON taggings (tag_id);
CREATE INDEX idx_taggings_record ON taggings (record_type, record_id);
CREATE INDEX idx_external_identities_entity ON external_identities (entity_type, entity_id);
CREATE INDEX idx_record_provenance_record ON record_provenance (record_type, record_id);
CREATE INDEX idx_assets_hash ON assets (content_hash) WHERE archived_at IS NULL;
CREATE INDEX idx_asset_links_record ON asset_links (record_type, record_id);
CREATE INDEX idx_asset_links_asset ON asset_links (asset_id);
CREATE INDEX idx_chat_conversations_updated ON chat_conversations (updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX idx_chat_messages_conversation ON chat_messages (conversation_id, created_at);

CREATE TRIGGER affiliations_ai_sync_person_current AFTER INSERT ON affiliations BEGIN
  UPDATE people
  SET current_organization_id = (
        SELECT organization_id FROM affiliations
        WHERE person_id = new.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      current_title = (
        SELECT title FROM affiliations
        WHERE person_id = new.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      current_department = (
        SELECT department FROM affiliations
        WHERE person_id = new.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      role_family = (
        SELECT role_family FROM affiliations
        WHERE person_id = new.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      seniority = (
        SELECT seniority FROM affiliations
        WHERE person_id = new.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = new.person_id;
END;

CREATE TRIGGER affiliations_au_sync_person_current AFTER UPDATE ON affiliations BEGIN
  UPDATE people
  SET current_organization_id = (
        SELECT organization_id FROM affiliations
        WHERE person_id = old.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      current_title = (
        SELECT title FROM affiliations
        WHERE person_id = old.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      current_department = (
        SELECT department FROM affiliations
        WHERE person_id = old.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      role_family = (
        SELECT role_family FROM affiliations
        WHERE person_id = old.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      seniority = (
        SELECT seniority FROM affiliations
        WHERE person_id = old.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = old.person_id;

  UPDATE people
  SET current_organization_id = (
        SELECT organization_id FROM affiliations
        WHERE person_id = new.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      current_title = (
        SELECT title FROM affiliations
        WHERE person_id = new.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      current_department = (
        SELECT department FROM affiliations
        WHERE person_id = new.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      role_family = (
        SELECT role_family FROM affiliations
        WHERE person_id = new.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      seniority = (
        SELECT seniority FROM affiliations
        WHERE person_id = new.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = new.person_id;
END;

CREATE TRIGGER affiliations_ad_sync_person_current AFTER DELETE ON affiliations BEGIN
  UPDATE people
  SET current_organization_id = (
        SELECT organization_id FROM affiliations
        WHERE person_id = old.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      current_title = (
        SELECT title FROM affiliations
        WHERE person_id = old.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      current_department = (
        SELECT department FROM affiliations
        WHERE person_id = old.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      role_family = (
        SELECT role_family FROM affiliations
        WHERE person_id = old.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      seniority = (
        SELECT seniority FROM affiliations
        WHERE person_id = old.person_id AND is_current = 1
        ORDER BY is_primary DESC, updated_at DESC, id DESC LIMIT 1
      ),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = old.person_id;
END;

CREATE VIEW relationship_strengths AS
WITH signals AS (
  SELECT
    people.id AS person_id,
    MAX(CASE WHEN interactions.archived_at IS NULL AND interactions.occurred_at IS NOT NULL THEN interactions.occurred_at END) AS last_interaction_at,
    COUNT(DISTINCT CASE
      WHEN interactions.archived_at IS NULL
       AND interactions.occurred_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-365 days')
      THEN interactions.id
    END) AS recent_interactions,
    CAST(julianday('now') - julianday(MAX(CASE WHEN interactions.archived_at IS NULL AND interactions.occurred_at IS NOT NULL THEN interactions.occurred_at END)) AS INTEGER) AS days_since_last,
    COUNT(DISTINCT CASE WHEN tasks.archived_at IS NULL AND tasks.status != 'done' THEN tasks.id END) AS open_tasks
  FROM people
  LEFT JOIN interaction_participants ON interaction_participants.person_id = people.id
  LEFT JOIN interactions ON interactions.id = interaction_participants.interaction_id
  LEFT JOIN task_people ON task_people.person_id = people.id
  LEFT JOIN tasks ON tasks.id = task_people.task_id
  WHERE people.is_self = 0
  GROUP BY people.id
),
scores AS (
  SELECT
    person_id,
    last_interaction_at,
    recent_interactions,
    days_since_last,
    open_tasks,
    min(recent_interactions, 5)
      + CASE
          WHEN days_since_last IS NULL THEN 0
          WHEN days_since_last <= 30 THEN 3
          WHEN days_since_last <= 90 THEN 2
          WHEN days_since_last <= 180 THEN 1
          ELSE 0
        END
      + min(open_tasks, 2) AS score
  FROM signals
)
SELECT
  person_id,
  last_interaction_at,
  CASE
    WHEN recent_interactions = 0 AND open_tasks = 0 THEN NULL
    WHEN score >= 8 THEN 5
    WHEN score >= 6 THEN 4
    WHEN score >= 4 THEN 3
    WHEN score >= 2 THEN 2
    ELSE 1
  END AS relationship_strength,
  recent_interactions,
  days_since_last,
  open_tasks
FROM scores;
