-- 0007_remove_chat.sql
--
-- Remove the retired Ask/chat surface from existing launch databases. Fresh
-- databases already omit these tables in 0002; this migration is idempotent so
-- both paths converge on the same schema.

DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_conversations;

DELETE FROM evidence_refs WHERE subject_type = 'chat_message';

DROP INDEX IF EXISTS idx_evidence_subject;
DROP INDEX IF EXISTS idx_evidence_chunk;

CREATE TABLE evidence_refs_next (
  id           TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('memory', 'task')),
  subject_id   TEXT NOT NULL,
  chunk_id     TEXT NOT NULL REFERENCES content_chunks (id) ON DELETE CASCADE,
  quote_start  INTEGER,
  quote_end    INTEGER,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO evidence_refs_next (
  id,
  subject_type,
  subject_id,
  chunk_id,
  quote_start,
  quote_end,
  note,
  created_at
)
SELECT
  id,
  subject_type,
  subject_id,
  chunk_id,
  quote_start,
  quote_end,
  note,
  created_at
FROM evidence_refs
WHERE subject_type IN ('memory', 'task');

DROP TABLE evidence_refs;
ALTER TABLE evidence_refs_next RENAME TO evidence_refs;

CREATE INDEX idx_evidence_subject ON evidence_refs (subject_type, subject_id);
CREATE INDEX idx_evidence_chunk ON evidence_refs (chunk_id);
