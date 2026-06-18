-- 0005_assets.sql
--
-- Durable manifest for app-managed binary files. Bytes live under the brain
-- root's assets/ directory; SQLite owns metadata and typed links.

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
    record_type IN ('person', 'organization', 'project', 'task', 'document', 'interaction')
  ),
  record_id   TEXT NOT NULL,
  role        TEXT,
  caption     TEXT,
  sort_order  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (asset_id, record_type, record_id, role)
);

CREATE INDEX idx_assets_hash ON assets (content_hash) WHERE archived_at IS NULL;
CREATE INDEX idx_asset_links_record ON asset_links (record_type, record_id);
CREATE INDEX idx_asset_links_asset ON asset_links (asset_id);
