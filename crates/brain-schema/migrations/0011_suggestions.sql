-- Suggestions: durable, user-facing proposals the importer must not auto-create
-- (a new project, a new organization). This is a curation queue awaiting the
-- user's ratification, NOT an automation log: every row is actionable (accepting
-- it performs a typed write) and cites the records that prompted it. Dismissals
-- are durable so an agent never re-proposes something the user declined.

CREATE TABLE suggestions (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('create_project', 'create_organization')),
  title       TEXT NOT NULL,
  payload_json TEXT,
  rationale   TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  resolved_record_type TEXT CHECK (
    resolved_record_type IS NULL
    OR resolved_record_type IN ('project', 'organization')
  ),
  resolved_record_id   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

-- Evidence: the visible records (interactions, people, …) that prompted a
-- suggestion. On accept these are relinked to the created project/organization.
CREATE TABLE suggestion_links (
  id            TEXT PRIMARY KEY,
  suggestion_id TEXT NOT NULL REFERENCES suggestions (id) ON DELETE CASCADE,
  record_type   TEXT NOT NULL CHECK (
    record_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction')
  ),
  record_id     TEXT NOT NULL,
  role          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (suggestion_id, record_type, record_id)
);

CREATE INDEX idx_suggestions_status ON suggestions (status);
CREATE INDEX idx_suggestions_kind_status ON suggestions (kind, status);
CREATE INDEX idx_suggestion_links_suggestion ON suggestion_links (suggestion_id);
