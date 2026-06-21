-- User-facing curation queue for inferred structure the importer must not
-- auto-create. This is not an automation log: every row is actionable and cites
-- visible evidence records.

CREATE TABLE suggestions (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (
    kind IN ('create_project', 'create_organization', 'create_affiliation', 'merge_record')
  ),
  title       TEXT NOT NULL,
  payload_json TEXT,
  rationale   TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  resolved_record_type TEXT,
  resolved_record_id   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

CREATE TABLE suggestion_links (
  id            TEXT PRIMARY KEY,
  suggestion_id TEXT NOT NULL REFERENCES suggestions (id) ON DELETE CASCADE,
  record_type   TEXT NOT NULL CHECK (
    record_type IN (
      'person', 'organization', 'organization_profile', 'project', 'task',
      'document', 'interaction', 'interaction_transcript', 'ai_note',
      'extracted_fact', 'memory', 'asset'
    )
  ),
  record_id     TEXT NOT NULL,
  role          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (suggestion_id, record_type, record_id)
);

CREATE INDEX idx_suggestions_status ON suggestions (status);
CREATE INDEX idx_suggestions_kind_status ON suggestions (kind, status);
CREATE INDEX idx_suggestion_links_suggestion ON suggestion_links (suggestion_id);
