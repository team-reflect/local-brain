-- Rebuildable search and vector projections.

CREATE VIRTUAL TABLE documents_fts USING fts5 (
  title,
  body_text,
  summary,
  content = 'documents',
  content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts (rowid, title, body_text, summary)
  VALUES (new.rowid, new.title, new.body_text, new.summary);
END;

CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts (documents_fts, rowid, title, body_text, summary)
  VALUES ('delete', old.rowid, old.title, old.body_text, old.summary);
END;

CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts (documents_fts, rowid, title, body_text, summary)
  VALUES ('delete', old.rowid, old.title, old.body_text, old.summary);
  INSERT INTO documents_fts (rowid, title, body_text, summary)
  VALUES (new.rowid, new.title, new.body_text, new.summary);
END;

CREATE VIRTUAL TABLE interactions_fts USING fts5 (
  title,
  body_text,
  summary,
  content = 'interactions',
  content_rowid = 'rowid',
  tokenize = 'porter unicode61'
);

CREATE TRIGGER interactions_ai AFTER INSERT ON interactions BEGIN
  INSERT INTO interactions_fts (rowid, title, body_text, summary)
  VALUES (new.rowid, new.title, new.body_text, new.summary);
END;

CREATE TRIGGER interactions_ad AFTER DELETE ON interactions BEGIN
  INSERT INTO interactions_fts (interactions_fts, rowid, title, body_text, summary)
  VALUES ('delete', old.rowid, old.title, old.body_text, old.summary);
END;

CREATE TRIGGER interactions_au AFTER UPDATE ON interactions BEGIN
  INSERT INTO interactions_fts (interactions_fts, rowid, title, body_text, summary)
  VALUES ('delete', old.rowid, old.title, old.body_text, old.summary);
  INSERT INTO interactions_fts (rowid, title, body_text, summary)
  VALUES (new.rowid, new.title, new.body_text, new.summary);
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

CREATE TABLE chunk_embeddings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id     TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (chunk_id, model_id)
);

CREATE INDEX chunk_embeddings_chunk ON chunk_embeddings (chunk_id);

CREATE VIRTUAL TABLE chunk_vectors USING vec0(embedding float[384] distance_metric=cosine);

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
  FROM asset_search_source
  WHERE asset_id = old.asset_id AND old.asset_id != new.asset_id
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
