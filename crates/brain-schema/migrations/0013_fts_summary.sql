-- Make interaction/document summaries searchable. Transcripts and email threads
-- store a concise digest (or a Granola AI note) in `summary`, separate from the
-- raw `body_text`; until now only title + body_text were indexed, so a summary
-- that didn't repeat the body was unfindable. Rebuild the FTS5 tables with a
-- `summary` column and matching triggers. FTS5 can't ALTER in a column, so drop +
-- recreate + rebuild. These tables are derived/rebuildable — no durable data is
-- touched, and 'rebuild' repopulates them from the content tables.

DROP TRIGGER documents_ai;
DROP TRIGGER documents_ad;
DROP TRIGGER documents_au;
DROP TABLE documents_fts;

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

INSERT INTO documents_fts (documents_fts) VALUES ('rebuild');

DROP TRIGGER interactions_ai;
DROP TRIGGER interactions_ad;
DROP TRIGGER interactions_au;
DROP TABLE interactions_fts;

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

INSERT INTO interactions_fts (interactions_fts) VALUES ('rebuild');
