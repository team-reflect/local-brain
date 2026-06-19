-- 0008_asset_search.sql
--
-- First-class search for asset metadata plus optional local/imported asset text.
-- The binary bytes still live under the brain root's assets/ directory; this
-- migration adds only durable searchable text and a rebuildable FTS projection.

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

CREATE TABLE asset_search (
  asset_id      TEXT PRIMARY KEY REFERENCES assets (id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  subtitle      TEXT,
  metadata_text TEXT,
  link_text     TEXT,
  body_text     TEXT,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE VIEW asset_search_source AS
SELECT
  a.id AS asset_id,
  COALESCE(NULLIF(trim(a.original_filename), ''), a.storage_path) AS title,
  COALESCE(NULLIF(trim(a.mime_type), ''), NULLIF(trim(a.kind), '')) AS subtitle,
  trim(
    COALESCE(a.original_filename, '') || ' ' ||
    COALESCE(a.kind, '') || ' ' ||
    COALESCE(a.mime_type, '') || ' ' ||
    COALESCE(a.storage_path, '') || ' ' ||
    COALESCE(a.original_url, '')
  ) AS metadata_text,
  (
    SELECT trim(COALESCE(group_concat(piece, ' '), ''))
    FROM (
      SELECT
        COALESCE(al.caption, '') || ' ' ||
        COALESCE(al.role, '') || ' ' ||
        COALESCE(p.full_name, o.name, pr.name, t.title, d.title, i.title, '') AS piece
      FROM asset_links al
      LEFT JOIN people p
        ON al.record_type = 'person' AND p.id = al.record_id AND p.archived_at IS NULL
      LEFT JOIN organizations o
        ON al.record_type = 'organization' AND o.id = al.record_id AND o.archived_at IS NULL
      LEFT JOIN projects pr
        ON al.record_type = 'project' AND pr.id = al.record_id AND pr.archived_at IS NULL
      LEFT JOIN tasks t
        ON al.record_type = 'task' AND t.id = al.record_id AND t.archived_at IS NULL
      LEFT JOIN documents d
        ON al.record_type = 'document' AND d.id = al.record_id AND d.archived_at IS NULL
      LEFT JOIN interactions i
        ON al.record_type = 'interaction' AND i.id = al.record_id AND i.archived_at IS NULL
      WHERE al.asset_id = a.id
    )
  ) AS link_text,
  at.text AS body_text,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS updated_at
FROM assets a
LEFT JOIN asset_texts at ON at.asset_id = a.id
WHERE a.archived_at IS NULL;

CREATE VIRTUAL TABLE assets_fts USING fts5 (
  title,
  metadata_text,
  link_text,
  body_text,
  content = 'asset_search',
  content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER asset_search_ai AFTER INSERT ON asset_search BEGIN
  INSERT INTO assets_fts (rowid, title, metadata_text, link_text, body_text)
  VALUES (new.rowid, new.title, new.metadata_text, new.link_text, new.body_text);
END;

CREATE TRIGGER asset_search_ad AFTER DELETE ON asset_search BEGIN
  INSERT INTO assets_fts (assets_fts, rowid, title, metadata_text, link_text, body_text)
  VALUES ('delete', old.rowid, old.title, old.metadata_text, old.link_text, old.body_text);
END;

CREATE TRIGGER asset_search_au AFTER UPDATE ON asset_search BEGIN
  INSERT INTO assets_fts (assets_fts, rowid, title, metadata_text, link_text, body_text)
  VALUES ('delete', old.rowid, old.title, old.metadata_text, old.link_text, old.body_text);
  INSERT INTO assets_fts (rowid, title, metadata_text, link_text, body_text)
  VALUES (new.rowid, new.title, new.metadata_text, new.link_text, new.body_text);
END;

CREATE TRIGGER assets_search_ai AFTER INSERT ON assets BEGIN
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source WHERE asset_id = new.id;
END;

CREATE TRIGGER assets_search_au AFTER UPDATE ON assets BEGIN
  DELETE FROM asset_search WHERE asset_id = old.id;
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source WHERE asset_id = new.id;
END;

CREATE TRIGGER assets_search_ad AFTER DELETE ON assets BEGIN
  DELETE FROM asset_search WHERE asset_id = old.id;
END;

CREATE TRIGGER asset_texts_search_ai AFTER INSERT ON asset_texts BEGIN
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source WHERE asset_id = new.asset_id
  ON CONFLICT(asset_id) DO UPDATE SET
    title = excluded.title,
    subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text,
    link_text = excluded.link_text,
    body_text = excluded.body_text,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER asset_texts_search_au AFTER UPDATE ON asset_texts BEGIN
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source WHERE asset_id = new.asset_id
  ON CONFLICT(asset_id) DO UPDATE SET
    title = excluded.title,
    subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text,
    link_text = excluded.link_text,
    body_text = excluded.body_text,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER asset_texts_search_ad AFTER DELETE ON asset_texts BEGIN
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source WHERE asset_id = old.asset_id
  ON CONFLICT(asset_id) DO UPDATE SET
    title = excluded.title,
    subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text,
    link_text = excluded.link_text,
    body_text = excluded.body_text,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER asset_links_search_ai AFTER INSERT ON asset_links BEGIN
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source WHERE asset_id = new.asset_id
  ON CONFLICT(asset_id) DO UPDATE SET
    title = excluded.title,
    subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text,
    link_text = excluded.link_text,
    body_text = excluded.body_text,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER asset_links_search_au AFTER UPDATE ON asset_links BEGIN
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source WHERE asset_id = new.asset_id
  ON CONFLICT(asset_id) DO UPDATE SET
    title = excluded.title,
    subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text,
    link_text = excluded.link_text,
    body_text = excluded.body_text,
    updated_at = excluded.updated_at;
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source WHERE asset_id = old.asset_id AND old.asset_id <> new.asset_id
  ON CONFLICT(asset_id) DO UPDATE SET
    title = excluded.title,
    subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text,
    link_text = excluded.link_text,
    body_text = excluded.body_text,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER asset_links_search_ad AFTER DELETE ON asset_links BEGIN
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source WHERE asset_id = old.asset_id
  ON CONFLICT(asset_id) DO UPDATE SET
    title = excluded.title,
    subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text,
    link_text = excluded.link_text,
    body_text = excluded.body_text,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER people_asset_search_au AFTER UPDATE OF full_name, archived_at ON people BEGIN
  UPDATE asset_search SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE asset_id IN (SELECT asset_id FROM asset_links WHERE record_type = 'person' AND record_id = new.id);
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source
  WHERE asset_id IN (SELECT asset_id FROM asset_links WHERE record_type = 'person' AND record_id = new.id)
  ON CONFLICT(asset_id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text, link_text = excluded.link_text,
    body_text = excluded.body_text, updated_at = excluded.updated_at;
END;

CREATE TRIGGER organizations_asset_search_au AFTER UPDATE OF name, archived_at ON organizations BEGIN
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source
  WHERE asset_id IN (SELECT asset_id FROM asset_links WHERE record_type = 'organization' AND record_id = new.id)
  ON CONFLICT(asset_id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text, link_text = excluded.link_text,
    body_text = excluded.body_text, updated_at = excluded.updated_at;
END;

CREATE TRIGGER projects_asset_search_au AFTER UPDATE OF name, archived_at ON projects BEGIN
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source
  WHERE asset_id IN (SELECT asset_id FROM asset_links WHERE record_type = 'project' AND record_id = new.id)
  ON CONFLICT(asset_id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text, link_text = excluded.link_text,
    body_text = excluded.body_text, updated_at = excluded.updated_at;
END;

CREATE TRIGGER tasks_asset_search_au AFTER UPDATE OF title, archived_at ON tasks BEGIN
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source
  WHERE asset_id IN (SELECT asset_id FROM asset_links WHERE record_type = 'task' AND record_id = new.id)
  ON CONFLICT(asset_id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text, link_text = excluded.link_text,
    body_text = excluded.body_text, updated_at = excluded.updated_at;
END;

CREATE TRIGGER documents_asset_search_au AFTER UPDATE OF title, archived_at ON documents BEGIN
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source
  WHERE asset_id IN (SELECT asset_id FROM asset_links WHERE record_type = 'document' AND record_id = new.id)
  ON CONFLICT(asset_id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text, link_text = excluded.link_text,
    body_text = excluded.body_text, updated_at = excluded.updated_at;
END;

CREATE TRIGGER interactions_asset_search_au AFTER UPDATE OF title, archived_at ON interactions BEGIN
  INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
  SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
  FROM asset_search_source
  WHERE asset_id IN (SELECT asset_id FROM asset_links WHERE record_type = 'interaction' AND record_id = new.id)
  ON CONFLICT(asset_id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle,
    metadata_text = excluded.metadata_text, link_text = excluded.link_text,
    body_text = excluded.body_text, updated_at = excluded.updated_at;
END;

INSERT INTO asset_search (asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at)
SELECT asset_id, title, subtitle, metadata_text, link_text, body_text, updated_at
FROM asset_search_source;
