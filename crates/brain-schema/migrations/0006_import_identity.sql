-- 0006_import_identity.sql
--
-- Provider-neutral import identity and contact handles. Upstream tools such as
-- gws translate provider data into these generic Local Brain primitives.

CREATE TABLE sources (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO sources (id, slug, name, description) VALUES
  ('source_manual', 'manual', 'Manual', 'User-entered or manually curated records.'),
  ('source_agent', 'agent', 'Agent', 'Records created by a local agent without a more specific upstream source.'),
  ('source_gmail', 'gmail', 'Gmail', 'Email messages and attachments sourced from Gmail.'),
  ('source_google_people', 'google_people', 'Google People', 'Contacts sourced from Google People / Contacts.'),
  ('source_google_calendar', 'google_calendar', 'Google Calendar', 'Events sourced from Google Calendar.'),
  ('source_google_meet', 'google_meet', 'Google Meet', 'Meetings or transcripts sourced from Google Meet.'),
  ('source_zoom', 'zoom', 'Zoom', 'Meetings or transcripts sourced from Zoom.'),
  ('source_file', 'file', 'File', 'Local files imported from disk.'),
  ('source_ai_extraction', 'ai_extraction', 'AI Extraction', 'Records created by AI extraction over other sources.');

CREATE TABLE external_identities (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction', 'asset')
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

CREATE INDEX idx_external_identities_entity ON external_identities (entity_type, entity_id);

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

CREATE INDEX idx_person_emails_normalized ON person_emails (normalized_email);

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

CREATE INDEX idx_person_phones_normalized ON person_phones (normalized_phone);

-- Preserve existing participant rows while allowing unresolved raw handles.
DROP VIEW IF EXISTS relationship_strengths;

ALTER TABLE interaction_participants RENAME TO interaction_participants_old;

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
  CHECK (
    person_id IS NOT NULL
    OR normalized_handle IS NOT NULL
    OR display_name IS NOT NULL
  )
);

INSERT INTO interaction_participants (
  id, interaction_id, person_id, role, created_at
)
SELECT id, interaction_id, person_id, role, created_at
FROM interaction_participants_old;

DROP TABLE interaction_participants_old;

CREATE UNIQUE INDEX uq_interaction_participants_person
  ON interaction_participants (interaction_id, person_id)
  WHERE person_id IS NOT NULL;

CREATE UNIQUE INDEX uq_interaction_participants_handle
  ON interaction_participants (interaction_id, normalized_handle, COALESCE(role, ''))
  WHERE normalized_handle IS NOT NULL;

CREATE INDEX idx_interaction_participants_person ON interaction_participants (person_id);
CREATE INDEX idx_interaction_participants_handle ON interaction_participants (normalized_handle);
CREATE INDEX idx_interaction_participants_source ON interaction_participants (source_id);

CREATE VIEW relationship_strengths AS
WITH signals AS (
  SELECT
    people.id AS person_id,
    people.reconnect_interval_days,
    MAX(CASE
      WHEN interactions.archived_at IS NULL AND interactions.occurred_at IS NOT NULL
      THEN interactions.occurred_at
    END) AS last_interaction_at,
    COUNT(DISTINCT CASE
      WHEN interactions.archived_at IS NULL
       AND interactions.occurred_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-365 days')
      THEN interactions.id
    END) AS recent_interactions,
    CAST(julianday('now') - julianday(MAX(CASE
      WHEN interactions.archived_at IS NULL AND interactions.occurred_at IS NOT NULL
      THEN interactions.occurred_at
    END)) AS INTEGER) AS days_since_last,
    COUNT(DISTINCT CASE
      WHEN tasks.archived_at IS NULL AND tasks.status != 'done'
      THEN tasks.id
    END) AS open_tasks
  FROM people
  LEFT JOIN interaction_participants ON interaction_participants.person_id = people.id
  LEFT JOIN interactions ON interactions.id = interaction_participants.interaction_id
  LEFT JOIN task_people ON task_people.person_id = people.id
  LEFT JOIN tasks ON tasks.id = task_people.task_id
  WHERE people.is_self = 0
  GROUP BY people.id, people.reconnect_interval_days
),
scores AS (
  SELECT
    person_id,
    last_interaction_at,
    CASE
      WHEN last_interaction_at IS NULL OR reconnect_interval_days IS NULL THEN NULL
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', last_interaction_at, printf('+%d days', reconnect_interval_days))
    END AS next_reconnect_at,
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
  next_reconnect_at,
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
