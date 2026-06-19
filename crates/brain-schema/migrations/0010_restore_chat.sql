-- 0010_restore_chat.sql
--
-- Restore Ask/chat as a durable product surface. Chat citations are not evidence
-- refs: messages keep their AI SDK UIMessage JSON plus queryable projection
-- fields, while grounding chunks remain request-local.

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

CREATE INDEX idx_chat_conversations_updated ON chat_conversations (updated_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX idx_chat_messages_conversation ON chat_messages (conversation_id, created_at);
